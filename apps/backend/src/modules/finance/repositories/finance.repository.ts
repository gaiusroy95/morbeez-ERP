import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface TenantMoneyContext {
  timezone: string;
  currency: string;
}

export interface ResolvedRange extends TenantMoneyContext {
  fromDate: string;
  toDate: string;
  startAt: Date;
  endAt: Date;
}

export interface ReceivableRow {
  customer_id: string;
  customer_name: string;
  credit_limit: string;
  payment_terms_days: number;
  credit_hold: boolean;
  invoiced: string;
  collected: string;
  outstanding: string;
  credit_on_account: string;
  not_yet_due: string;
  overdue_1_30: string;
  overdue_31_60: string;
  overdue_over_60: string;
  open_order_value: string;
  last_collection_at: Date | null;
}

export interface PayableRow {
  farmer_id: string;
  farmer_name: string;
  owed: string;
  overdue: string;
  unpaid_lots: number;
  oldest_unpaid_accrued_at: Date | null;
  advance: string;
  last_paid_at: Date | null;
}

export interface PayableLotRow {
  lot_id: string;
  purchase_order_id: string;
  product_id: string;
  product_name: string;
  accepted_quantity: string;
  unit_cost: string;
  amount: string;
  paid: string;
  outstanding: string;
  accrued_at: Date;
}

export interface CashTotalsRow {
  cash_in: string;
  farmer_payments_out: string;
  expenses_out: string;
  finance_costs_out: string;
  net: string;
}

export interface CashDayRow {
  date: string;
  cash_in: string;
  cash_out: string;
}

export type CashMovementKindRow = 'collection' | 'collection_reversed' | 'farmer_payment' | 'trip_expense' | 'finance_cost';

export interface CashMovementRow {
  at: Date;
  kind: CashMovementKindRow;
  counterparty: string;
  detail: string;
  amount: string;
  reference_id: string;
}

export interface TripAwaitingRow {
  trip_id: string;
  vehicle_registration: string;
  driver_name: string;
  completed_at: Date | null;
  advance_amount: string;
  expenses: string;
  cash_collected: string;
}

export interface TripReconciledRow {
  trip_id: string;
  vehicle_registration: string;
  driver_name: string;
  reconciled_at: Date;
  advance_amount: string;
  total_expenses: string;
  cash_returned: string;
  variance: string;
}

export interface StatementRow {
  at: Date;
  kind: 'invoice' | 'finance_charge' | 'payment' | 'payment_reversal';
  reference: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface TrialBalanceRowDb {
  account: string;
  name: string;
  root_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  debit: string;
  credit: string;
  balance: string;
}

// Every movement of real money, as (instant, in, out, kind, …). Customer
// money counts net of what the channel kept (the fee never reached us);
// a reversal takes that same net amount back out. Farmer transfer fees and
// recorded finance costs are outflows of their own. Trip expenses are paid
// from the driver's float — cash that left, even though Logistics doesn't
// post them to the ledger yet.
const CASH_MOVEMENTS = `
  SELECT p.received_at AS at, 'collection' AS kind, c.name AS counterparty, p.method AS detail,
         (p.amount - p.fee_amount) AS cash_in, 0::numeric AS cash_out, p.id AS reference_id
    FROM money.customer_payment p JOIN trading_partners.customer c ON c.id = p.customer_id
  UNION ALL
  SELECT r.reversed_at, 'collection_reversed', c.name, r.reason, 0, (p.amount - p.fee_amount), p.id
    FROM money.customer_payment_reversal r
    JOIN money.customer_payment p ON p.id = r.payment_id
    JOIN trading_partners.customer c ON c.id = p.customer_id
  UNION ALL
  SELECT p.paid_at, 'farmer_payment', f.name, p.method, 0, p.amount, p.id
    FROM money.farmer_payment p JOIN trading_partners.farmer f ON f.id = p.farmer_id
  UNION ALL
  SELECT p.paid_at, 'finance_cost', f.name, 'payment_fee', 0, p.fee_amount, p.id
    FROM money.farmer_payment p JOIN trading_partners.farmer f ON f.id = p.farmer_id
   WHERE p.fee_amount > 0
  UNION ALL
  SELECT fc.incurred_at, 'finance_cost', fc.description, fc.category, 0, fc.amount, fc.id
    FROM money.finance_cost fc
  UNION ALL
  SELECT e.recorded_at, 'trip_expense', v.registration_number, e.category, 0, e.amount, e.trip_id
    FROM fulfilment.trip_expense e
    JOIN fulfilment.trip tr ON tr.id = e.trip_id
    JOIN trading_partners.vehicle v ON v.id = tr.vehicle_id`;

/**
 * A read model over Finance's own tables plus Orders, Procurement, and
 * Logistics — the same reporting exception DashboardRepository takes
 * (System Architecture DB.4). Never writes. RLS scopes every statement to
 * the tenant; the client always comes from DatabaseService.withTenant.
 */
@Injectable()
export class FinanceRepository {
  async tenantContext(client: PoolClient): Promise<TenantMoneyContext | null> {
    const result = await client.query<TenantMoneyContext>(
      'SELECT timezone, currency FROM tenant.tenant WHERE id = current_tenant_id()',
    );
    return result.rows[0] ?? null;
  }

  /**
   * Tenant-local calendar dates -> [startAt, endAt) instants. `to` defaults
   * to today in the tenant's timezone; `from` to `defaultDays` days ending
   * on `to`.
   */
  async resolveRange(
    client: PoolClient,
    from: string | null,
    to: string | null,
    defaultDays: number,
  ): Promise<ResolvedRange | null> {
    const result = await client.query<{
      timezone: string;
      currency: string;
      from_date: string;
      to_date: string;
      start_at: Date;
      end_at: Date;
    }>(
      `WITH base AS (
         SELECT timezone, currency, COALESCE($2::date, (now() AT TIME ZONE timezone)::date) AS to_date
         FROM tenant.tenant WHERE id = current_tenant_id()
       ),
       d AS (SELECT timezone, currency, to_date, COALESCE($1::date, to_date - ($3::int - 1)) AS from_date FROM base)
       SELECT timezone, currency, from_date::text AS from_date, to_date::text AS to_date,
              from_date::timestamp AT TIME ZONE timezone AS start_at,
              (to_date + 1)::timestamp AT TIME ZONE timezone AS end_at
       FROM d`,
      [from, to, defaultDays],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      timezone: row.timezone,
      currency: row.currency,
      fromDate: row.from_date,
      toDate: row.to_date,
      startAt: row.start_at,
      endAt: row.end_at,
    };
  }

  /**
   * One row per customer with anything invoiced, paid, or on order. Each
   * open invoice lands in one aging bucket by its own due date (tenant-local
   * today). Credit on account (unapplied payments) is shown beside the
   * buckets rather than netted into them — it belongs to no invoice yet.
   */
  async receivables(client: PoolClient): Promise<ReceivableRow[]> {
    const result = await client.query<ReceivableRow>(
      `WITH today AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM tenant.tenant WHERE id = current_tenant_id()),
       inv AS (
         SELECT b.customer_id,
                SUM(b.amount) FILTER (WHERE b.kind = 'sale') AS invoiced,
                SUM(b.outstanding) AS outstanding,
                SUM(b.outstanding) FILTER (WHERE b.due_date >= today.d) AS not_yet_due,
                SUM(b.outstanding) FILTER (WHERE today.d - b.due_date BETWEEN 1 AND 30) AS overdue_1_30,
                SUM(b.outstanding) FILTER (WHERE today.d - b.due_date BETWEEN 31 AND 60) AS overdue_31_60,
                SUM(b.outstanding) FILTER (WHERE today.d - b.due_date > 60) AS overdue_over_60
         FROM money.invoice_balance b, today
         GROUP BY b.customer_id
       ),
       pay AS (
         SELECT customer_id,
                SUM(amount) FILTER (WHERE reversed_at IS NULL) AS collected,
                SUM(unapplied) AS credit_on_account,
                MAX(received_at) FILTER (WHERE reversed_at IS NULL) AS last_collection_at
         FROM money.customer_payment_balance
         GROUP BY customer_id
       ),
       open_orders AS (
         SELECT o.customer_id, SUM(ol.quantity * ol.unit_price) AS value
         FROM commerce.customer_order o JOIN commerce.customer_order_line ol ON ol.order_id = o.id
         WHERE o.status = 'confirmed'
         GROUP BY o.customer_id
       )
       SELECT c.id AS customer_id, c.name AS customer_name, c.credit_limit::text AS credit_limit,
              c.payment_terms_days, c.credit_hold,
              ROUND(COALESCE(inv.invoiced, 0), 2)::text AS invoiced,
              ROUND(COALESCE(pay.collected, 0), 2)::text AS collected,
              ROUND(COALESCE(inv.outstanding, 0), 2)::text AS outstanding,
              ROUND(COALESCE(pay.credit_on_account, 0), 2)::text AS credit_on_account,
              ROUND(COALESCE(inv.not_yet_due, 0), 2)::text AS not_yet_due,
              ROUND(COALESCE(inv.overdue_1_30, 0), 2)::text AS overdue_1_30,
              ROUND(COALESCE(inv.overdue_31_60, 0), 2)::text AS overdue_31_60,
              ROUND(COALESCE(inv.overdue_over_60, 0), 2)::text AS overdue_over_60,
              ROUND(COALESCE(oo.value, 0), 2)::text AS open_order_value,
              pay.last_collection_at
       FROM trading_partners.customer c
       LEFT JOIN inv ON inv.customer_id = c.id
       LEFT JOIN pay ON pay.customer_id = c.id
       LEFT JOIN open_orders oo ON oo.customer_id = c.id
       WHERE inv.customer_id IS NOT NULL OR pay.customer_id IS NOT NULL OR oo.customer_id IS NOT NULL
       ORDER BY COALESCE(inv.outstanding, 0) DESC, c.name`,
    );
    return result.rows;
  }

  async payables(client: PoolClient, overdueAfterDays: number): Promise<PayableRow[]> {
    const result = await client.query<PayableRow>(
      `WITH owed AS (
         SELECT farmer_id,
                SUM(outstanding) AS owed,
                SUM(outstanding) FILTER (WHERE accrued_at < now() - make_interval(days => $1)) AS overdue,
                count(*) AS unpaid_lots,
                MIN(accrued_at) AS oldest
         FROM money.farmer_payable_balance WHERE outstanding > 0
         GROUP BY farmer_id
       ),
       paid AS (
         SELECT farmer_id, SUM(unapplied) AS advance, MAX(paid_at) AS last_paid_at
         FROM money.farmer_payment_balance GROUP BY farmer_id
       )
       SELECT f.id AS farmer_id, f.name AS farmer_name,
              ROUND(COALESCE(owed.owed, 0), 2)::text AS owed,
              ROUND(COALESCE(owed.overdue, 0), 2)::text AS overdue,
              COALESCE(owed.unpaid_lots, 0)::int AS unpaid_lots,
              owed.oldest AS oldest_unpaid_accrued_at,
              ROUND(COALESCE(paid.advance, 0), 2)::text AS advance,
              paid.last_paid_at
       FROM trading_partners.farmer f
       LEFT JOIN owed ON owed.farmer_id = f.id
       LEFT JOIN paid ON paid.farmer_id = f.id
       WHERE COALESCE(owed.owed, 0) > 0 OR COALESCE(paid.advance, 0) > 0
       ORDER BY COALESCE(owed.owed, 0) DESC, f.name`,
      [overdueAfterDays],
    );
    return result.rows;
  }

  async payableLotsForFarmer(client: PoolClient, farmerId: string): Promise<PayableLotRow[]> {
    const result = await client.query<PayableLotRow>(
      `SELECT b.lot_id, l.purchase_order_id, l.product_id, p.name AS product_name,
              l.accepted_quantity::text AS accepted_quantity, l.unit_cost::text AS unit_cost,
              b.amount::text AS amount, b.paid::text AS paid, b.outstanding::text AS outstanding, b.accrued_at
       FROM money.farmer_payable_balance b
       JOIN commerce.lot l ON l.id = b.lot_id
       JOIN trading_partners.product p ON p.id = l.product_id
       WHERE b.farmer_id = $1 AND b.outstanding > 0
       ORDER BY b.accrued_at`,
      [farmerId],
    );
    return result.rows;
  }

  async cashTotals(client: PoolClient, startAt: Date, endAt: Date): Promise<CashTotalsRow> {
    const result = await client.query<CashTotalsRow>(
      `WITH m AS (SELECT * FROM (${CASH_MOVEMENTS}) x WHERE at >= $1 AND at < $2),
       t AS (
         SELECT COALESCE(SUM(cash_in), 0) - COALESCE(SUM(cash_out) FILTER (WHERE kind = 'collection_reversed'), 0) AS cash_in,
                COALESCE(SUM(cash_out) FILTER (WHERE kind = 'farmer_payment'), 0) AS farmer_payments_out,
                COALESCE(SUM(cash_out) FILTER (WHERE kind = 'trip_expense'), 0) AS expenses_out,
                COALESCE(SUM(cash_out) FILTER (WHERE kind = 'finance_cost'), 0) AS finance_costs_out
         FROM m
       )
       SELECT ROUND(cash_in, 2)::text AS cash_in,
              ROUND(farmer_payments_out, 2)::text AS farmer_payments_out,
              ROUND(expenses_out, 2)::text AS expenses_out,
              ROUND(finance_costs_out, 2)::text AS finance_costs_out,
              ROUND(cash_in - farmer_payments_out - expenses_out - finance_costs_out, 2)::text AS net
       FROM t`,
      [startAt, endAt],
    );
    return result.rows[0];
  }

  /** Every tenant-local day in [fromDate, toDate], zero-filled. */
  async cashByDay(
    client: PoolClient,
    timezone: string,
    fromDate: string,
    toDate: string,
    startAt: Date,
    endAt: Date,
  ): Promise<CashDayRow[]> {
    const result = await client.query<CashDayRow>(
      `WITH days AS (SELECT generate_series($3::date, $4::date, interval '1 day')::date AS day),
       m AS (SELECT (at AT TIME ZONE $5)::date AS day, cash_in, cash_out FROM (${CASH_MOVEMENTS}) x WHERE at >= $1 AND at < $2)
       SELECT d.day::text AS date,
              ROUND(COALESCE(SUM(m.cash_in), 0), 2)::text AS cash_in,
              ROUND(COALESCE(SUM(m.cash_out), 0), 2)::text AS cash_out
       FROM days d LEFT JOIN m ON m.day = d.day
       GROUP BY d.day ORDER BY d.day`,
      [startAt, endAt, fromDate, toDate, timezone],
    );
    return result.rows;
  }

  async recentCashMovements(client: PoolClient, startAt: Date, endAt: Date, limit: number): Promise<CashMovementRow[]> {
    const result = await client.query<CashMovementRow>(
      `SELECT at, kind, counterparty, detail, ROUND(cash_in + cash_out, 2)::text AS amount, reference_id
       FROM (${CASH_MOVEMENTS}) x
       WHERE at >= $1 AND at < $2
       ORDER BY at DESC
       LIMIT $3`,
      [startAt, endAt, limit],
    );
    return result.rows;
  }

  async tripsAwaitingReconciliation(client: PoolClient): Promise<TripAwaitingRow[]> {
    const result = await client.query<TripAwaitingRow>(
      `SELECT t.id AS trip_id,
              v.registration_number AS vehicle_registration,
              emp.name AS driver_name,
              t.completed_at,
              t.advance_amount::text AS advance_amount,
              (SELECT ROUND(COALESCE(SUM(e.amount), 0), 2)::text FROM fulfilment.trip_expense e
                WHERE e.trip_id = t.id) AS expenses,
              (SELECT ROUND(COALESCE(SUM(c.amount), 0), 2)::text
                 FROM money.customer_collection c
                 JOIN fulfilment.trip_stop s ON s.id = c.trip_stop_id
                WHERE s.trip_id = t.id) AS cash_collected
       FROM fulfilment.trip t
       JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
       JOIN trading_partners.employee emp ON emp.id = t.driver_employee_id
       WHERE t.status = 'completed'
       ORDER BY t.completed_at NULLS LAST`,
    );
    return result.rows;
  }

  async recentReconciliations(client: PoolClient, limit: number): Promise<TripReconciledRow[]> {
    const result = await client.query<TripReconciledRow>(
      `SELECT r.trip_id,
              v.registration_number AS vehicle_registration,
              emp.name AS driver_name,
              r.reconciled_at,
              r.advance_amount::text AS advance_amount,
              r.total_expenses::text AS total_expenses,
              r.cash_returned::text AS cash_returned,
              r.variance::text AS variance
       FROM fulfilment.trip_reconciliation r
       JOIN fulfilment.trip t ON t.id = r.trip_id
       JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
       JOIN trading_partners.employee emp ON emp.id = t.driver_employee_id
       ORDER BY r.reconciled_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  /** Value of the customer's confirmed, not-yet-delivered orders — the order side of credit exposure. */
  async openOrderValue(client: PoolClient, customerId: string): Promise<string> {
    const result = await client.query<{ value: string }>(
      `SELECT ROUND(COALESCE(SUM(ol.quantity * ol.unit_price), 0), 2)::text AS value
       FROM commerce.customer_order o JOIN commerce.customer_order_line ol ON ol.order_id = o.id
       WHERE o.customer_id = $1 AND o.status = 'confirmed'`,
      [customerId],
    );
    return result.rows[0].value;
  }

  /**
   * A customer's account, invoice by payment, with a running balance.
   * Debits raise what they owe (invoices, reversed payments); credits
   * lower it (payments). The opening balance is everything before startAt.
   */
  async statement(
    client: PoolClient,
    customerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<{ opening: string; lines: StatementRow[] }> {
    const events = `
      SELECT i.issued_at AS at, CASE WHEN i.kind = 'sale' THEN 'invoice' ELSE 'finance_charge' END AS kind,
             i.invoice_number AS reference,
             CASE WHEN i.kind = 'sale' THEN 'Invoice, due ' || to_char(i.due_date, 'DD Mon YYYY')
                  ELSE 'Finance charge on ' || si.invoice_number END AS description,
             i.amount AS debit, 0::numeric AS credit
        FROM money.invoice i LEFT JOIN money.invoice si ON si.id = i.source_invoice_id
       WHERE i.customer_id = $1
      UNION ALL
      SELECT p.received_at, 'payment', COALESCE(p.reference, initcap(replace(p.method, '_', ' '))),
             'Payment received (' || replace(p.method, '_', ' ') || ')', 0, p.amount
        FROM money.customer_payment p WHERE p.customer_id = $1
      UNION ALL
      SELECT r.reversed_at, 'payment_reversal', COALESCE(p.reference, initcap(replace(p.method, '_', ' '))),
             'Payment reversed: ' || r.reason, p.amount, 0
        FROM money.customer_payment_reversal r JOIN money.customer_payment p ON p.id = r.payment_id
       WHERE p.customer_id = $1`;
    const opening = await client.query<{ opening: string }>(
      `SELECT ROUND(COALESCE(SUM(debit - credit), 0), 2)::text AS opening FROM (${events}) e WHERE at < $2`,
      [customerId, startAt],
    );
    const lines = await client.query<StatementRow>(
      `SELECT at, kind, reference, description, ROUND(debit, 2)::text AS debit, ROUND(credit, 2)::text AS credit,
              ROUND($4::numeric + SUM(debit - credit) OVER (ORDER BY at, reference ROWS UNBOUNDED PRECEDING), 2)::text AS balance
       FROM (${events}) e
       WHERE at >= $2 AND at < $3
       ORDER BY at, reference`,
      [customerId, startAt, endAt, opening.rows[0].opening],
    );
    return { opening: opening.rows[0].opening, lines: lines.rows };
  }

  /** Every account, even those with no postings, summed from the ledger up to endAt. */
  async trialBalance(client: PoolClient, endAt: Date): Promise<TrialBalanceRowDb[]> {
    const result = await client.query<TrialBalanceRowDb>(
      `SELECT a.code AS account, a.name, a.root_type,
              ROUND(COALESCE(SUM(l.debit), 0), 2)::text AS debit,
              ROUND(COALESCE(SUM(l.credit), 0), 2)::text AS credit,
              ROUND(COALESCE(SUM(l.debit - l.credit), 0), 2)::text AS balance
       FROM money.account a
       LEFT JOIN (
         SELECT l.* FROM money.ledger_line l JOIN money.ledger_entry e ON e.id = l.entry_id WHERE e.occurred_at < $1
       ) l ON l.account_code = a.code
       GROUP BY a.code, a.number, a.name, a.root_type
       ORDER BY a.number`,
      [endAt],
    );
    return result.rows;
  }

  /**
   * The control accounts as their sub-ledgers see them, for reconciling
   * against the trial balance: AR = open invoices − credit on account;
   * AP = open payables; farmer advances = unapplied farmer payments.
   */
  async subledgerTotals(client: PoolClient): Promise<{ receivable: string; payable: string; advances: string }> {
    const result = await client.query<{ receivable: string; payable: string; advances: string }>(
      `SELECT
         ROUND((SELECT COALESCE(SUM(outstanding), 0) FROM money.invoice_balance)
             - (SELECT COALESCE(SUM(unapplied), 0) FROM money.customer_payment_balance), 2)::text AS receivable,
         ROUND((SELECT COALESCE(SUM(outstanding), 0) FROM money.farmer_payable_balance), 2)::text AS payable,
         ROUND((SELECT COALESCE(SUM(unapplied), 0) FROM money.farmer_payment_balance), 2)::text AS advances`,
    );
    return result.rows[0];
  }
}
