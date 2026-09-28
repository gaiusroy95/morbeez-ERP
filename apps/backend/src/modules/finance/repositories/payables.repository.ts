import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { FarmerPaymentRecord, LotPaymentStatus, PaymentMethod } from '../entities/finance-engine.entity';

interface FarmerPaymentRow {
  payment_id: string;
  farmer_id: string;
  farmer_name: string;
  amount: string;
  fee_amount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  paid_at: Date;
  applied: string;
  unapplied: string;
}

export interface OpenPayable {
  id: string;
  lotId: string;
  outstanding: string;
}

const PAYMENT_SELECT = `
  SELECT b.payment_id, b.farmer_id, f.name AS farmer_name, b.amount::text AS amount, b.fee_amount::text AS fee_amount,
         b.method, b.reference, p.notes, b.paid_at, b.applied::text AS applied, b.unapplied::text AS unapplied
  FROM money.farmer_payment_balance b
  JOIN money.farmer_payment p ON p.id = b.payment_id
  JOIN trading_partners.farmer f ON f.id = b.farmer_id`;

function toPayment(row: FarmerPaymentRow): FarmerPaymentRecord {
  return {
    id: row.payment_id,
    farmerId: row.farmer_id,
    farmerName: row.farmer_name,
    amount: row.amount,
    feeAmount: row.fee_amount,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    paidAt: row.paid_at,
    applied: row.applied,
    unapplied: row.unapplied,
  };
}

@Injectable()
export class PayablesRepository {
  /** Same reasoning as ReceivablesRepository.lockCustomerWithClient, per farmer. */
  async lockFarmerWithClient(client: PoolClient, farmerId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('finance.farmer'), hashtext($1))`, [farmerId]);
  }

  /**
   * For TDS: the grading date in the tenant's timezone, and what had
   * already accrued to this farmer earlier in the same financial year
   * (1 April – 31 March), this payable excluded.
   */
  async accruedThisYearWithClient(
    client: PoolClient,
    farmerId: string,
    at: Date,
    excludePayableId: string,
  ): Promise<{ date: string; prior: string }> {
    const result = await client.query<{ date: string; prior: string }>(
      `WITH d AS (
         SELECT (($2::timestamptz) AT TIME ZONE t.timezone)::date AS day, t.timezone
         FROM tenant.tenant t WHERE t.id = current_tenant_id()
       ), fy AS (
         SELECT day, timezone,
                make_date(CASE WHEN extract(month FROM day) >= 4 THEN extract(year FROM day)::int
                               ELSE extract(year FROM day)::int - 1 END, 4, 1) AS fy_start
         FROM d
       )
       SELECT fy.day::text AS date,
              COALESCE((SELECT SUM(p.amount) FROM money.farmer_payable p
                        WHERE p.farmer_id = $1 AND p.id <> $3
                          AND p.accrued_at >= (fy.fy_start::timestamp AT TIME ZONE fy.timezone)
                          AND p.accrued_at <= $2), 0)::text AS prior
       FROM fy`,
      [farmerId, at, excludePayableId],
    );
    return result.rows[0];
  }

  /** accepted quantity × unit cost, rounded to the paisa in SQL. */
  async lotValueWithClient(client: PoolClient, acceptedQuantity: string, unitCost: string): Promise<string> {
    const result = await client.query<{ value: string }>('SELECT ROUND($1::numeric * $2::numeric, 2)::text AS value', [
      acceptedQuantity,
      unitCost,
    ]);
    return result.rows[0].value;
  }

  async insertPayableWithClient(
    client: PoolClient,
    fields: { tenantId: string; lotId: string; farmerId: string; amount: string; accruedAt: Date; createdBy: string },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO money.farmer_payable (tenant_id, lot_id, farmer_id, amount, accrued_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [fields.tenantId, fields.lotId, fields.farmerId, fields.amount, fields.accruedAt, fields.createdBy],
    );
    return result.rows[0].id;
  }

  /** Oldest accrued first — the order payments are applied in. */
  async openPayablesForFarmerWithClient(client: PoolClient, farmerId: string): Promise<OpenPayable[]> {
    const result = await client.query<{ payable_id: string; lot_id: string; outstanding: string }>(
      `SELECT payable_id, lot_id, outstanding::text AS outstanding FROM money.farmer_payable_balance
       WHERE farmer_id = $1 AND outstanding > 0
       ORDER BY accrued_at, lot_id`,
      [farmerId],
    );
    return result.rows.map((r) => ({ id: r.payable_id, lotId: r.lot_id, outstanding: r.outstanding }));
  }

  /** The farmer's advances — unapplied payment money, oldest first. */
  async unappliedPaymentsForFarmerWithClient(client: PoolClient, farmerId: string): Promise<{ id: string; unapplied: string }[]> {
    const result = await client.query<{ payment_id: string; unapplied: string }>(
      `SELECT payment_id, unapplied::text AS unapplied FROM money.farmer_payment_balance
       WHERE farmer_id = $1 AND unapplied > 0 ORDER BY paid_at, payment_id`,
      [farmerId],
    );
    return result.rows.map((r) => ({ id: r.payment_id, unapplied: r.unapplied }));
  }

  async insertPaymentWithClient(
    client: PoolClient,
    fields: {
      tenantId: string;
      farmerId: string;
      amount: string;
      feeAmount: string;
      method: PaymentMethod;
      reference: string | null;
      notes: string | null;
      paidAt: Date;
      recordedBy: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO money.farmer_payment
         (tenant_id, farmer_id, amount, fee_amount, method, reference, notes, paid_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        fields.tenantId,
        fields.farmerId,
        fields.amount,
        fields.feeAmount,
        fields.method,
        fields.reference,
        fields.notes,
        fields.paidAt,
        fields.recordedBy,
      ],
    );
    return result.rows[0].id;
  }

  async insertAllocationsWithClient(
    client: PoolClient,
    tenantId: string,
    allocations: { paymentId: string; payableId: string; amount: string }[],
  ): Promise<void> {
    for (const a of allocations) {
      await client.query(
        `INSERT INTO money.farmer_payment_allocation (tenant_id, payment_id, payable_id, amount) VALUES ($1, $2, $3, $4)`,
        [tenantId, a.paymentId, a.payableId, a.amount],
      );
    }
  }

  async findPaymentWithClient(client: PoolClient, id: string): Promise<FarmerPaymentRecord | null> {
    const result = await client.query<FarmerPaymentRow>(`${PAYMENT_SELECT} WHERE b.payment_id = $1`, [id]);
    if (!result.rows[0]) return null;
    const payment = toPayment(result.rows[0]);
    const allocations = await client.query<{ lot_id: string; amount: string; allocated_at: Date }>(
      `SELECT fp.lot_id, a.amount::text AS amount, a.allocated_at
       FROM money.farmer_payment_allocation a JOIN money.farmer_payable fp ON fp.id = a.payable_id
       WHERE a.payment_id = $1 ORDER BY a.allocated_at, fp.accrued_at`,
      [id],
    );
    payment.allocations = allocations.rows.map((a) => ({ lotId: a.lot_id, amount: a.amount, allocatedAt: a.allocated_at }));
    return payment;
  }

  async listPaymentsWithClient(
    client: PoolClient,
    farmerId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<FarmerPaymentRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;
    const rows = await client.query<FarmerPaymentRow>(
      `${PAYMENT_SELECT} WHERE ($1::uuid IS NULL OR b.farmer_id = $1)
       ORDER BY b.paid_at DESC, b.payment_id LIMIT $2 OFFSET $3`,
      [farmerId ?? null, size, offset],
    );
    const count = await client.query<{ count: string }>(
      'SELECT count(*) FROM money.farmer_payment WHERE ($1::uuid IS NULL OR farmer_id = $1)',
      [farmerId ?? null],
    );
    return { items: rows.rows.map(toPayment), total: Number(count.rows[0].count), page: Math.max(page, 1), pageSize: size };
  }

  async lotStatusWithClient(client: PoolClient, lotIds: string[]): Promise<LotPaymentStatus[]> {
    if (lotIds.length === 0) return [];
    const result = await client.query<{ lot_id: string; amount: string; paid: string; outstanding: string }>(
      `SELECT lot_id, amount::text AS amount, paid::text AS paid, outstanding::text AS outstanding
       FROM money.farmer_payable_balance WHERE lot_id = ANY($1::uuid[])`,
      [lotIds],
    );
    return result.rows.map((r) => ({ lotId: r.lot_id, payable: r.amount, paid: r.paid, outstanding: r.outstanding }));
  }
}
