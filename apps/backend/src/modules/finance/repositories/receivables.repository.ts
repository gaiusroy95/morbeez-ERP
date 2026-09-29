import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import {
  CustomerPaymentRecord,
  FinanceChargeRecord,
  InvoiceKind,
  InvoiceLineRecord,
  InvoiceRecord,
  InvoiceState,
  PaymentMethod,
} from '../entities/finance-engine.entity';

interface InvoiceRow {
  invoice_id: string;
  invoice_number: string;
  kind: InvoiceKind;
  customer_id: string;
  customer_name: string;
  order_id: string | null;
  source_invoice_id: string | null;
  issued_at: Date;
  due_date: string;
  amount: string;
  paid: string;
  outstanding: string;
  state: InvoiceState;
}

interface PaymentRow {
  payment_id: string;
  customer_id: string;
  customer_name: string;
  amount: string;
  fee_amount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  collection_id: string | null;
  received_at: Date;
  applied: string;
  unapplied: string;
  reversed_at: Date | null;
  reversal_reason: string | null;
}

interface FinanceChargeRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  source_invoice_id: string;
  source_invoice_number: string;
  customer_id: string;
  customer_name: string;
  period_start: string;
  period_end: string;
  principal: string;
  rate_monthly_percent: string;
  days: number;
  amount: string;
  created_at: Date;
}

export interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  kind: InvoiceKind;
  orderId: string | null;
  dueDate: string;
  outstanding: string;
}

export interface UnappliedPayment {
  id: string;
  unapplied: string;
}

export interface ChargeCandidate {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  dueDate: string;
  outstanding: string;
  rateMonthly: string;
  graceDays: number;
  lastPeriodEnd: string | null;
}

export type InvoiceFilter = 'all' | 'open' | 'overdue' | 'paid';

// Tenant-local "today" drives open/overdue — an invoice due today isn't late.
const INVOICE_SELECT = `
  SELECT b.invoice_id, b.invoice_number, b.kind, b.customer_id, c.name AS customer_name, b.order_id,
         b.source_invoice_id, b.issued_at, b.due_date::text AS due_date, b.amount::text AS amount,
         b.paid::text AS paid, b.outstanding::text AS outstanding,
         CASE WHEN b.outstanding <= 0 THEN 'paid'
              WHEN b.due_date < (now() AT TIME ZONE t.timezone)::date THEN 'overdue'
              ELSE 'open' END AS state
  FROM money.invoice_balance b
  JOIN trading_partners.customer c ON c.id = b.customer_id
  JOIN tenant.tenant t ON t.id = b.tenant_id`;

const PAYMENT_SELECT = `
  SELECT b.payment_id, b.customer_id, c.name AS customer_name, b.amount::text AS amount,
         b.fee_amount::text AS fee_amount, b.method, b.reference, p.notes, b.collection_id, b.received_at,
         b.applied::text AS applied, b.unapplied::text AS unapplied, b.reversed_at, r.reason AS reversal_reason
  FROM money.customer_payment_balance b
  JOIN money.customer_payment p ON p.id = b.payment_id
  JOIN trading_partners.customer c ON c.id = b.customer_id
  LEFT JOIN money.customer_payment_reversal r ON r.payment_id = b.payment_id`;

const CHARGE_SELECT = `
  SELECT fc.id, fc.invoice_id, i.invoice_number, fc.source_invoice_id, si.invoice_number AS source_invoice_number,
         i.customer_id, c.name AS customer_name, fc.period_start::text AS period_start, fc.period_end::text AS period_end,
         fc.principal::text AS principal, fc.rate_monthly_percent::text AS rate_monthly_percent, fc.days,
         fc.amount::text AS amount, fc.created_at
  FROM money.finance_charge fc
  JOIN money.invoice i ON i.id = fc.invoice_id
  JOIN money.invoice si ON si.id = fc.source_invoice_id
  JOIN trading_partners.customer c ON c.id = i.customer_id`;

function toInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.invoice_id,
    invoiceNumber: row.invoice_number,
    kind: row.kind,
    customerId: row.customer_id,
    customerName: row.customer_name,
    orderId: row.order_id,
    sourceInvoiceId: row.source_invoice_id,
    issuedAt: row.issued_at,
    dueDate: row.due_date,
    amount: row.amount,
    paid: row.paid,
    outstanding: row.outstanding,
    state: row.state,
  };
}

function toPayment(row: PaymentRow): CustomerPaymentRecord {
  return {
    id: row.payment_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amount: row.amount,
    feeAmount: row.fee_amount,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    collectionId: row.collection_id,
    receivedAt: row.received_at,
    applied: row.applied,
    unapplied: row.unapplied,
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
  };
}

function toCharge(row: FinanceChargeRow): FinanceChargeRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    sourceInvoiceId: row.source_invoice_id,
    sourceInvoiceNumber: row.source_invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    principal: row.principal,
    rateMonthlyPercent: row.rate_monthly_percent,
    days: row.days,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

@Injectable()
export class ReceivablesRepository {
  /**
   * Serialises every balance-changing write for one customer within a
   * transaction. An advisory lock rather than SELECT ... FOR UPDATE: the
   * app role can't UPDATE invoices (they're append-only), and FOR UPDATE
   * needs that privilege. Released at COMMIT/ROLLBACK.
   */
  async lockCustomerWithClient(client: PoolClient, customerId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('finance.customer'), hashtext($1))`, [customerId]);
  }

  /** The tenant's walk-in customer, created the first time a spot sale needs it. */
  async walkInCustomerWithClient(client: PoolClient, tenantId: string, userId: string): Promise<string> {
    await client.query(
      `INSERT INTO trading_partners.customer (tenant_id, name, is_walk_in, created_by) VALUES ($1, 'Walk-in customers', true, $2)
       ON CONFLICT (tenant_id) WHERE is_walk_in DO NOTHING`,
      [tenantId, userId],
    );
    const result = await client.query<{ id: string }>('SELECT id FROM trading_partners.customer WHERE is_walk_in');
    return result.rows[0].id;
  }

  async todayWithClient(client: PoolClient): Promise<string> {
    const result = await client.query<{ today: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return result.rows[0].today;
  }

  /** Gap-free per tenant and kind: the counter row's lock serialises concurrent issuers. */
  async nextInvoiceNumberWithClient(client: PoolClient, tenantId: string, kind: InvoiceKind): Promise<string> {
    const result = await client.query<{ last_number: number }>(
      `INSERT INTO money.invoice_counter (tenant_id, kind, last_number) VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, kind) DO UPDATE SET last_number = money.invoice_counter.last_number + 1
       RETURNING last_number`,
      [tenantId, kind],
    );
    const prefix = { sale: 'INV', finance_charge: 'FC', crate_charge: 'CRT', spot_sale: 'SPT' }[kind];
    return `${prefix}-${String(result.rows[0].last_number).padStart(6, '0')}`;
  }

  /** Line amounts and the total, rounded to the paisa in SQL — never a JS float. */
  async priceLinesWithClient(
    client: PoolClient,
    lines: { quantity: string; unitPrice: string }[],
  ): Promise<{ amounts: string[]; total: string }> {
    const result = await client.query<{ amount: string; total: string }>(
      `SELECT ROUND(q * p, 2)::text AS amount, SUM(ROUND(q * p, 2)) OVER ()::text AS total
       FROM unnest($1::numeric[], $2::numeric[]) WITH ORDINALITY AS l(q, p, n)
       ORDER BY n`,
      [lines.map((l) => l.quantity), lines.map((l) => l.unitPrice)],
    );
    return { amounts: result.rows.map((r) => r.amount), total: result.rows[0]?.total ?? '0.00' };
  }

  async insertInvoiceWithClient(
    client: PoolClient,
    fields: {
      tenantId: string;
      invoiceNumber: string;
      kind: InvoiceKind;
      customerId: string;
      orderId: string | null;
      sourceInvoiceId: string | null;
      issuedAt: Date;
      dueDate: string;
      amount: string;
      createdBy: string;
      lines: Omit<InvoiceLineRecord, 'id'>[];
    },
  ): Promise<{ invoiceId: string; lineIds: string[] }> {
    const invoice = await client.query<{ id: string }>(
      `INSERT INTO money.invoice
         (tenant_id, invoice_number, kind, customer_id, order_id, source_invoice_id, issued_at, due_date, amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        fields.tenantId,
        fields.invoiceNumber,
        fields.kind,
        fields.customerId,
        fields.orderId,
        fields.sourceInvoiceId,
        fields.issuedAt,
        fields.dueDate,
        fields.amount,
        fields.createdBy,
      ],
    );
    const invoiceId = invoice.rows[0].id;
    const lineIds: string[] = [];
    for (const line of fields.lines) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO money.invoice_line
           (tenant_id, invoice_id, order_line_id, product_id, description, quantity, unit_price, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          fields.tenantId,
          invoiceId,
          line.orderLineId,
          line.productId,
          line.description,
          line.quantity,
          line.unitPrice,
          line.amount,
        ],
      );
      lineIds.push(inserted.rows[0].id);
    }
    return { invoiceId, lineIds };
  }

  async findInvoiceWithClient(client: PoolClient, id: string): Promise<InvoiceRecord | null> {
    const result = await client.query<InvoiceRow>(`${INVOICE_SELECT} WHERE b.invoice_id = $1`, [id]);
    if (!result.rows[0]) return null;
    const invoice = toInvoice(result.rows[0]);
    const lines = await client.query<{
      id: string;
      order_line_id: string | null;
      product_id: string | null;
      description: string;
      quantity: string;
      unit_price: string;
      amount: string;
    }>(
      `SELECT id, order_line_id, product_id, description, quantity::text, unit_price::text, amount::text
       FROM money.invoice_line WHERE invoice_id = $1 ORDER BY description`,
      [id],
    );
    const payments = await client.query<{
      payment_id: string;
      amount: string;
      received_at: Date;
      method: PaymentMethod;
      reversed: boolean;
    }>(
      `SELECT a.payment_id, a.amount::text AS amount, p.received_at, p.method,
              EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = p.id) AS reversed
       FROM money.customer_payment_allocation a
       JOIN money.customer_payment p ON p.id = a.payment_id
       WHERE a.invoice_id = $1
       ORDER BY p.received_at`,
      [id],
    );
    invoice.lines = lines.rows.map((l) => ({
      id: l.id,
      orderLineId: l.order_line_id,
      productId: l.product_id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      amount: l.amount,
    }));
    invoice.payments = payments.rows.map((p) => ({
      paymentId: p.payment_id,
      amount: p.amount,
      receivedAt: p.received_at,
      method: p.method,
      reversed: p.reversed,
    }));
    return invoice;
  }

  async findInvoiceByOrderWithClient(client: PoolClient, orderId: string): Promise<InvoiceRecord | null> {
    const result = await client.query<InvoiceRow>(`${INVOICE_SELECT} WHERE b.order_id = $1`, [orderId]);
    return result.rows[0] ? toInvoice(result.rows[0]) : null;
  }

  async listInvoicesWithClient(
    client: PoolClient,
    filter: { customerId?: string; state: InvoiceFilter; kind?: InvoiceKind },
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<InvoiceRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;
    const where = `WHERE ($1::uuid IS NULL OR q.customer_id = $1) AND ($2 = 'all' OR q.state = $2)
                     AND ($3::text IS NULL OR q.kind = $3)`;
    const params = [filter.customerId ?? null, filter.state, filter.kind ?? null];
    // Sequential — one pooled client runs one query at a time.
    const rows = await client.query<InvoiceRow>(
      `SELECT * FROM (${INVOICE_SELECT}) q ${where}
       ORDER BY q.issued_at DESC, q.invoice_number DESC LIMIT $4 OFFSET $5`,
      [...params, size, offset],
    );
    const count = await client.query<{ count: string }>(`SELECT count(*) FROM (${INVOICE_SELECT}) q ${where}`, params);
    return { items: rows.rows.map(toInvoice), total: Number(count.rows[0].count), page: Math.max(page, 1), pageSize: size };
  }

  /** Oldest due first — the order collections are applied in. */
  async openInvoicesForCustomerWithClient(client: PoolClient, customerId: string): Promise<OpenInvoice[]> {
    const result = await client.query<{
      invoice_id: string;
      invoice_number: string;
      kind: InvoiceKind;
      order_id: string | null;
      due_date: string;
      outstanding: string;
    }>(
      `SELECT invoice_id, invoice_number, kind, order_id, due_date::text AS due_date, outstanding::text AS outstanding
       FROM money.invoice_balance
       WHERE customer_id = $1 AND outstanding > 0
       ORDER BY due_date, issued_at, invoice_number`,
      [customerId],
    );
    return result.rows.map((r) => ({
      id: r.invoice_id,
      invoiceNumber: r.invoice_number,
      kind: r.kind,
      orderId: r.order_id,
      dueDate: r.due_date,
      outstanding: r.outstanding,
    }));
  }

  /** Oldest received first — the order held credit is drawn down in. */
  async unappliedPaymentsForCustomerWithClient(client: PoolClient, customerId: string): Promise<UnappliedPayment[]> {
    const result = await client.query<{ payment_id: string; unapplied: string }>(
      `SELECT payment_id, unapplied::text AS unapplied FROM money.customer_payment_balance
       WHERE customer_id = $1 AND unapplied > 0
       ORDER BY received_at, payment_id`,
      [customerId],
    );
    return result.rows.map((r) => ({ id: r.payment_id, unapplied: r.unapplied }));
  }

  async insertPaymentWithClient(
    client: PoolClient,
    fields: {
      tenantId: string;
      customerId: string;
      amount: string;
      feeAmount: string;
      method: PaymentMethod;
      reference: string | null;
      notes: string | null;
      collectionId: string | null;
      receivedAt: Date;
      recordedBy: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO money.customer_payment
         (tenant_id, customer_id, amount, fee_amount, method, reference, notes, collection_id, received_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        fields.tenantId,
        fields.customerId,
        fields.amount,
        fields.feeAmount,
        fields.method,
        fields.reference,
        fields.notes,
        fields.collectionId,
        fields.receivedAt,
        fields.recordedBy,
      ],
    );
    return result.rows[0].id;
  }

  async insertAllocationsWithClient(
    client: PoolClient,
    tenantId: string,
    allocations: { paymentId: string; invoiceId: string; amount: string }[],
  ): Promise<void> {
    for (const a of allocations) {
      await client.query(
        `INSERT INTO money.customer_payment_allocation (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)`,
        [tenantId, a.paymentId, a.invoiceId, a.amount],
      );
    }
  }

  async insertReversalWithClient(
    client: PoolClient,
    tenantId: string,
    paymentId: string,
    reason: string,
    reversedBy: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.customer_payment_reversal (tenant_id, payment_id, reason, reversed_by) VALUES ($1, $2, $3, $4)`,
      [tenantId, paymentId, reason, reversedBy],
    );
  }

  async findPaymentWithClient(client: PoolClient, id: string): Promise<CustomerPaymentRecord | null> {
    const result = await client.query<PaymentRow>(`${PAYMENT_SELECT} WHERE b.payment_id = $1`, [id]);
    if (!result.rows[0]) return null;
    const payment = toPayment(result.rows[0]);
    const allocations = await client.query<{ invoice_id: string; invoice_number: string; amount: string }>(
      `SELECT a.invoice_id, i.invoice_number, a.amount::text AS amount
       FROM money.customer_payment_allocation a JOIN money.invoice i ON i.id = a.invoice_id
       WHERE a.payment_id = $1 ORDER BY a.allocated_at, i.invoice_number`,
      [id],
    );
    payment.allocations = allocations.rows.map((a) => ({
      invoiceId: a.invoice_id,
      invoiceNumber: a.invoice_number,
      amount: a.amount,
    }));
    return payment;
  }

  async listPaymentsWithClient(
    client: PoolClient,
    customerId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<CustomerPaymentRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;
    const rows = await client.query<PaymentRow>(
      `${PAYMENT_SELECT} WHERE ($1::uuid IS NULL OR b.customer_id = $1)
       ORDER BY b.received_at DESC, b.payment_id LIMIT $2 OFFSET $3`,
      [customerId ?? null, size, offset],
    );
    const count = await client.query<{ count: string }>(
      'SELECT count(*) FROM money.customer_payment WHERE ($1::uuid IS NULL OR customer_id = $1)',
      [customerId ?? null],
    );
    return { items: rows.rows.map(toPayment), total: Number(count.rows[0].count), page: Math.max(page, 1), pageSize: size };
  }

  /** What the customer owes net of credit they've already paid in. */
  async customerBalanceWithClient(
    client: PoolClient,
    customerId: string,
  ): Promise<{ invoicedOutstanding: string; unappliedCredit: string; overdue: string; oldestOverdueDays: number | null }> {
    const result = await client.query<{
      invoiced_outstanding: string;
      unapplied_credit: string;
      overdue: string;
      oldest_overdue_days: number | null;
    }>(
      `WITH today AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM tenant.tenant WHERE id = current_tenant_id())
       SELECT
         (SELECT COALESCE(SUM(outstanding), 0)::numeric(14,2)::text FROM money.invoice_balance
           WHERE customer_id = $1 AND outstanding > 0) AS invoiced_outstanding,
         (SELECT COALESCE(SUM(unapplied), 0)::numeric(14,2)::text FROM money.customer_payment_balance
           WHERE customer_id = $1) AS unapplied_credit,
         (SELECT COALESCE(SUM(outstanding), 0)::numeric(14,2)::text FROM money.invoice_balance, today
           WHERE customer_id = $1 AND outstanding > 0 AND due_date < today.d) AS overdue,
         (SELECT (today.d - MIN(due_date))::int FROM money.invoice_balance, today
           WHERE customer_id = $1 AND outstanding > 0 AND due_date < today.d GROUP BY today.d) AS oldest_overdue_days`,
      [customerId],
    );
    const row = result.rows[0];
    return {
      invoicedOutstanding: row.invoiced_outstanding,
      unappliedCredit: row.unapplied_credit,
      overdue: row.overdue,
      oldestOverdueDays: row.oldest_overdue_days,
    };
  }

  /**
   * Sale invoices now far enough past due to accrue a charge, for customers
   * whose terms carry a rate. Finance-charge invoices themselves never
   * accrue — no interest on interest.
   */
  async financeChargeCandidatesWithClient(client: PoolClient, asOf: string): Promise<ChargeCandidate[]> {
    const result = await client.query<{
      invoice_id: string;
      invoice_number: string;
      customer_id: string;
      due_date: string;
      outstanding: string;
      rate: string;
      grace: number;
      last_period_end: string | null;
    }>(
      `SELECT b.invoice_id, b.invoice_number, b.customer_id, b.due_date::text AS due_date,
              b.outstanding::text AS outstanding, c.finance_charge_rate_monthly::text AS rate,
              c.finance_charge_grace_days AS grace,
              (SELECT MAX(fc.period_end)::text FROM money.finance_charge fc WHERE fc.source_invoice_id = b.invoice_id) AS last_period_end
       FROM money.invoice_balance b
       JOIN trading_partners.customer c ON c.id = b.customer_id
       WHERE b.kind = 'sale' AND b.outstanding > 0 AND c.finance_charge_rate_monthly > 0
         AND b.due_date + c.finance_charge_grace_days < $1::date
       ORDER BY b.customer_id, b.due_date`,
      [asOf],
    );
    return result.rows.map((r) => ({
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
      customerId: r.customer_id,
      dueDate: r.due_date,
      outstanding: r.outstanding,
      rateMonthly: r.rate,
      graceDays: r.grace,
      lastPeriodEnd: r.last_period_end,
    }));
  }

  async insertFinanceChargeWithClient(
    client: PoolClient,
    fields: {
      tenantId: string;
      invoiceId: string;
      sourceInvoiceId: string;
      periodStart: string;
      periodEnd: string;
      principal: string;
      rate: string;
      days: number;
      amount: string;
      createdBy: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO money.finance_charge
         (tenant_id, invoice_id, source_invoice_id, period_start, period_end, principal, rate_monthly_percent, days, amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        fields.tenantId,
        fields.invoiceId,
        fields.sourceInvoiceId,
        fields.periodStart,
        fields.periodEnd,
        fields.principal,
        fields.rate,
        fields.days,
        fields.amount,
        fields.createdBy,
      ],
    );
    return result.rows[0].id;
  }

  async findChargesWithClient(client: PoolClient, ids: string[]): Promise<FinanceChargeRecord[]> {
    if (ids.length === 0) return [];
    const result = await client.query<FinanceChargeRow>(`${CHARGE_SELECT} WHERE fc.id = ANY($1::uuid[]) ORDER BY c.name, si.invoice_number`, [ids]);
    return result.rows.map(toCharge);
  }

  async listChargesWithClient(
    client: PoolClient,
    customerId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<FinanceChargeRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;
    const rows = await client.query<FinanceChargeRow>(
      `${CHARGE_SELECT} WHERE ($1::uuid IS NULL OR i.customer_id = $1)
       ORDER BY fc.created_at DESC, i.invoice_number DESC LIMIT $2 OFFSET $3`,
      [customerId ?? null, size, offset],
    );
    const count = await client.query<{ count: string }>(
      `SELECT count(*) FROM money.finance_charge fc JOIN money.invoice i ON i.id = fc.invoice_id
       WHERE ($1::uuid IS NULL OR i.customer_id = $1)`,
      [customerId ?? null],
    );
    return { items: rows.rows.map(toCharge), total: Number(count.rows[0].count), page: Math.max(page, 1), pageSize: size };
  }
}
