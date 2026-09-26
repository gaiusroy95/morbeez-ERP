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
  delivered: string;
  collected: string;
  outstanding: string;
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
  unsettled_lots: number;
  oldest_unsettled_graded_at: Date | null;
  last_settled_at: Date | null;
}

export interface UnsettledLotRow {
  lot_id: string;
  purchase_order_id: string;
  product_id: string;
  product_name: string;
  accepted_quantity: string;
  unit_cost: string;
  value: string;
  graded_at: Date;
}

export interface CashTotalsRow {
  cash_in: string;
  settlements_out: string;
  expenses_out: string;
  net: string;
}

export interface CashDayRow {
  date: string;
  cash_in: string;
  cash_out: string;
}

export interface CashMovementRow {
  at: Date;
  kind: 'collection' | 'settlement' | 'trip_expense';
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

// A lot is payable once graded with a positive accepted quantity and a
// fixed unit cost, and stays payable until a farmer_settlement row exists
// for it — the same definition the dashboard's payables balance uses.
const UNSETTLED_LOT = `
  l.unit_cost IS NOT NULL AND l.accepted_quantity > 0
  AND NOT EXISTS (SELECT 1 FROM money.farmer_settlement fs WHERE fs.lot_id = l.id)`;

/**
 * A read model over Orders, Procurement, Logistics, and Money — the same
 * reporting exception DashboardRepository takes (System Architecture DB.4).
 * Never writes. RLS scopes every statement to the tenant; the client always
 * comes from DatabaseService.withTenant.
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
   * One row per customer with anything delivered, collected, or open.
   * Collections are recorded against a specific order, so each delivered
   * order is aged on its own: due = delivery date + the customer's payment
   * terms, and what's left unpaid on it lands in one aging bucket.
   */
  async receivables(client: PoolClient): Promise<ReceivableRow[]> {
    const result = await client.query<ReceivableRow>(
      `WITH order_value AS (
         SELECT o.id AS order_id, o.customer_id, o.status, SUM(ol.quantity * ol.unit_price) AS value
         FROM commerce.customer_order o
         JOIN commerce.customer_order_line ol ON ol.order_id = o.id
         WHERE o.status IN ('confirmed', 'delivered')
         GROUP BY o.id, o.customer_id, o.status
       ),
       delivered_at AS (
         SELECT s.order_id, MAX(s.completed_at) AS at
         FROM fulfilment.trip_stop s
         JOIN fulfilment.trip t ON t.id = s.trip_id
         WHERE s.stop_type = 'delivery' AND s.status = 'completed'
         GROUP BY s.order_id
       ),
       collected AS (
         SELECT order_id, SUM(amount) AS amount, MAX(collected_at) AS last_at
         FROM money.customer_collection
         GROUP BY order_id
       ),
       per_order AS (
         SELECT ov.customer_id,
                ov.status,
                ov.value,
                COALESCE(c.amount, 0) AS collected,
                c.last_at,
                GREATEST(ov.value - COALESCE(c.amount, 0), 0) AS unpaid,
                (now()::date - (COALESCE(d.at, now())::date + cu.payment_terms_days)) AS days_overdue
         FROM order_value ov
         JOIN trading_partners.customer cu ON cu.id = ov.customer_id
         LEFT JOIN delivered_at d ON d.order_id = ov.order_id
         LEFT JOIN collected c ON c.order_id = ov.order_id
       )
       SELECT cu.id AS customer_id,
              cu.name AS customer_name,
              cu.credit_limit::text AS credit_limit,
              cu.payment_terms_days,
              ROUND(COALESCE(SUM(po.value) FILTER (WHERE po.status = 'delivered'), 0), 2)::text AS delivered,
              ROUND(COALESCE(SUM(po.collected), 0), 2)::text AS collected,
              ROUND(COALESCE(SUM(po.unpaid) FILTER (WHERE po.status = 'delivered'), 0), 2)::text AS outstanding,
              ROUND(COALESCE(SUM(po.unpaid) FILTER (WHERE po.status = 'delivered' AND po.days_overdue <= 0), 0), 2)::text AS not_yet_due,
              ROUND(COALESCE(SUM(po.unpaid) FILTER (WHERE po.status = 'delivered' AND po.days_overdue BETWEEN 1 AND 30), 0), 2)::text AS overdue_1_30,
              ROUND(COALESCE(SUM(po.unpaid) FILTER (WHERE po.status = 'delivered' AND po.days_overdue BETWEEN 31 AND 60), 0), 2)::text AS overdue_31_60,
              ROUND(COALESCE(SUM(po.unpaid) FILTER (WHERE po.status = 'delivered' AND po.days_overdue > 60), 0), 2)::text AS overdue_over_60,
              ROUND(COALESCE(SUM(po.value) FILTER (WHERE po.status = 'confirmed'), 0), 2)::text AS open_order_value,
              MAX(po.last_at) AS last_collection_at
       FROM per_order po
       JOIN trading_partners.customer cu ON cu.id = po.customer_id
       GROUP BY cu.id, cu.name, cu.credit_limit, cu.payment_terms_days
       ORDER BY SUM(po.unpaid) FILTER (WHERE po.status = 'delivered') DESC NULLS LAST, cu.name`,
    );
    return result.rows;
  }

  async payables(client: PoolClient, overdueAfterDays: number): Promise<PayableRow[]> {
    const result = await client.query<PayableRow>(
      `WITH unsettled AS (
         SELECT l.farmer_id, l.accepted_quantity * l.unit_cost AS value, l.graded_at
         FROM commerce.lot l
         WHERE ${UNSETTLED_LOT}
       ),
       settled AS (
         SELECT farmer_id, MAX(settled_at) AS last_at FROM money.farmer_settlement GROUP BY farmer_id
       )
       SELECT f.id AS farmer_id,
              f.name AS farmer_name,
              ROUND(SUM(u.value), 2)::text AS owed,
              ROUND(COALESCE(SUM(u.value) FILTER (WHERE u.graded_at < now() - make_interval(days => $1)), 0), 2)::text AS overdue,
              count(*)::int AS unsettled_lots,
              MIN(u.graded_at) AS oldest_unsettled_graded_at,
              s.last_at AS last_settled_at
       FROM unsettled u
       JOIN trading_partners.farmer f ON f.id = u.farmer_id
       LEFT JOIN settled s ON s.farmer_id = f.id
       GROUP BY f.id, f.name, s.last_at
       ORDER BY SUM(u.value) DESC, f.name`,
      [overdueAfterDays],
    );
    return result.rows;
  }

  async unsettledLotsForFarmer(client: PoolClient, farmerId: string): Promise<UnsettledLotRow[]> {
    const result = await client.query<UnsettledLotRow>(
      `SELECT l.id AS lot_id,
              l.purchase_order_id,
              l.product_id,
              p.name AS product_name,
              l.accepted_quantity::text AS accepted_quantity,
              l.unit_cost::text AS unit_cost,
              ROUND(l.accepted_quantity * l.unit_cost, 2)::text AS value,
              l.graded_at
       FROM commerce.lot l
       JOIN trading_partners.product p ON p.id = l.product_id
       WHERE l.farmer_id = $1 AND ${UNSETTLED_LOT}
       ORDER BY l.graded_at`,
      [farmerId],
    );
    return result.rows;
  }

  async cashTotals(client: PoolClient, startAt: Date, endAt: Date): Promise<CashTotalsRow> {
    const result = await client.query<CashTotalsRow>(
      `WITH t AS (
         SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM money.customer_collection
             WHERE collected_at >= $1 AND collected_at < $2) AS cash_in,
           (SELECT COALESCE(SUM(amount), 0) FROM money.farmer_settlement
             WHERE settled_at >= $1 AND settled_at < $2) AS settlements_out,
           (SELECT COALESCE(SUM(e.amount), 0) FROM fulfilment.trip_expense e
              JOIN fulfilment.trip tr ON tr.id = e.trip_id
             WHERE e.recorded_at >= $1 AND e.recorded_at < $2) AS expenses_out
       )
       SELECT ROUND(cash_in, 2)::text AS cash_in,
              ROUND(settlements_out, 2)::text AS settlements_out,
              ROUND(expenses_out, 2)::text AS expenses_out,
              ROUND(cash_in - settlements_out - expenses_out, 2)::text AS net
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
      `WITH days AS (
         SELECT generate_series($3::date, $4::date, interval '1 day')::date AS day
       ),
       moves AS (
         SELECT (collected_at AT TIME ZONE $5)::date AS day, amount AS cash_in, 0::numeric AS cash_out
           FROM money.customer_collection WHERE collected_at >= $1 AND collected_at < $2
         UNION ALL
         SELECT (settled_at AT TIME ZONE $5)::date, 0, amount
           FROM money.farmer_settlement WHERE settled_at >= $1 AND settled_at < $2
         UNION ALL
         SELECT (e.recorded_at AT TIME ZONE $5)::date, 0, e.amount
           FROM fulfilment.trip_expense e JOIN fulfilment.trip tr ON tr.id = e.trip_id
          WHERE e.recorded_at >= $1 AND e.recorded_at < $2
       )
       SELECT d.day::text AS date,
              ROUND(COALESCE(SUM(m.cash_in), 0), 2)::text AS cash_in,
              ROUND(COALESCE(SUM(m.cash_out), 0), 2)::text AS cash_out
       FROM days d
       LEFT JOIN moves m ON m.day = d.day
       GROUP BY d.day
       ORDER BY d.day`,
      [startAt, endAt, fromDate, toDate, timezone],
    );
    return result.rows;
  }

  async recentCashMovements(client: PoolClient, startAt: Date, endAt: Date, limit: number): Promise<CashMovementRow[]> {
    const result = await client.query<CashMovementRow>(
      `SELECT * FROM (
         SELECT c.collected_at AS at, 'collection' AS kind, cu.name AS counterparty, c.method AS detail,
                c.amount::text AS amount, c.order_id AS reference_id
           FROM money.customer_collection c
           JOIN commerce.customer_order o ON o.id = c.order_id
           JOIN trading_partners.customer cu ON cu.id = o.customer_id
          WHERE c.collected_at >= $1 AND c.collected_at < $2
         UNION ALL
         SELECT fs.settled_at, 'settlement', f.name, fs.method, fs.amount::text, fs.lot_id
           FROM money.farmer_settlement fs
           JOIN trading_partners.farmer f ON f.id = fs.farmer_id
          WHERE fs.settled_at >= $1 AND fs.settled_at < $2
         UNION ALL
         SELECT e.recorded_at, 'trip_expense', v.registration_number, e.category, e.amount::text, e.trip_id
           FROM fulfilment.trip_expense e
           JOIN fulfilment.trip tr ON tr.id = e.trip_id
           JOIN trading_partners.vehicle v ON v.id = tr.vehicle_id
          WHERE e.recorded_at >= $1 AND e.recorded_at < $2
       ) m
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
}
