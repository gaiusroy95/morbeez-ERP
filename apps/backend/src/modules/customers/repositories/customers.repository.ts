import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { CustomerRecord } from '../entities/customer.entity';

interface CustomerRow {
  id: string;
  tenant_id: string;
  name: string;
  contact: Record<string, unknown>;
  place: string | null;
  address: string | null;
  route_id: string | null;
  preferred_language: string;
  credit_limit: string;
  payment_terms_days: number;
  finance_charge_rate_monthly: string;
  finance_charge_rate_annual: string;
  finance_charge_grace_days: number;
  credit_hold: boolean;
  credit_hold_reason: string | null;
  is_walk_in: boolean;
  do_not_call: boolean;
  qr_token: string;
  status: 'active' | 'archived';
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

// A customer's usual route is the route they're a stop on (Routes owns trading_partners.route_stop).
const CUSTOMER_SELECT = `SELECT c.*, (SELECT s.route_id FROM trading_partners.route_stop s WHERE s.customer_id = c.id) AS route_id
  FROM trading_partners.customer c`;

function toRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    contact: row.contact ?? {},
    place: row.place ?? null,
    address: row.address ?? null,
    routeId: row.route_id ?? null,
    preferredLanguage: row.preferred_language ?? 'en',
    creditLimit: row.credit_limit,
    paymentTermsDays: row.payment_terms_days,
    financeChargeRateMonthly: row.finance_charge_rate_monthly,
    financeChargeRateAnnual: row.finance_charge_rate_annual ?? '0.00',
    financeChargeGraceDays: row.finance_charge_grace_days,
    creditHold: row.credit_hold,
    creditHoldReason: row.credit_hold_reason,
    isWalkIn: row.is_walk_in,
    doNotCall: row.do_not_call ?? false,
    qrToken: row.qr_token,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<CustomerRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<CustomerRow>(
          `${CUSTOMER_SELECT}
           ORDER BY c.name
           LIMIT $1 OFFSET $2`,
          [size, offset],
        ),
        client.query<{ count: string }>(
          'SELECT count(*) FROM trading_partners.customer',
        ),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<CustomerRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<CustomerRecord | null> {
    const result = await client.query<CustomerRow>(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      name: string;
      contact: Record<string, unknown>;
      creditLimit: number;
      paymentTermsDays: number;
      preferredLanguage?: string;
      place?: string | null;
      address?: string | null;
    },
  ): Promise<CustomerRecord> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO trading_partners.customer
         (tenant_id, name, contact, credit_limit, payment_terms_days, created_by, preferred_language, place, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        tenantId,
        fields.name,
        JSON.stringify(fields.contact),
        fields.creditLimit,
        fields.paymentTermsDays,
        createdBy,
        fields.preferredLanguage ?? 'en',
        fields.place ?? null,
        fields.address ?? null,
      ],
    );
    return (await this.findByIdWithClient(client, result.rows[0].id))!;
  }

  /**
   * Optimistic concurrency: the UPDATE only matches a row still at
   * `expectedVersion`. Zero rows back means someone else changed it since
   * the caller last read it — OptimisticLockException (409), never a
   * silently lost update (Production Database, Section 03).
   */
  async updateWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: Partial<{
      name: string;
      contact: Record<string, unknown>;
      preferredLanguage: string;
      // A key that is present (even as null) is written; one left out is kept.
      place: string | null;
      address: string | null;
      doNotCall: boolean;
    }>,
  ): Promise<CustomerRecord> {
    const result = await client.query<{ id: string }>(
      `UPDATE trading_partners.customer SET
         name = COALESCE($3, name),
         contact = COALESCE($4, contact),
         preferred_language = COALESCE($5, preferred_language),
         place = CASE WHEN $6::boolean THEN $7 ELSE place END,
         address = CASE WHEN $8::boolean THEN $9 ELSE address END,
         do_not_call = COALESCE($10, do_not_call),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING id`,
      [
        id,
        expectedVersion,
        fields.name,
        fields.contact ? JSON.stringify(fields.contact) : null,
        fields.preferredLanguage ?? null,
        'place' in fields,
        fields.place ?? null,
        'address' in fields,
        fields.address ?? null,
        fields.doNotCall ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Customer', id);
    }
    return (await this.findByIdWithClient(client, id))!;
  }

  /**
   * Credit terms only — a separate statement from updateWithClient so the
   * permission split (customers:credit vs customers:write) has a single
   * write path to guard. A hold's reason is cleared when the hold lifts.
   */
  async updateCreditTermsWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: {
      creditLimit?: number;
      paymentTermsDays?: number;
      financeChargeRateMonthly?: number;
      financeChargeRateAnnual?: number;
      financeChargeGraceDays?: number;
      creditHold?: boolean;
      creditHoldReason?: string | null;
    },
  ): Promise<CustomerRecord> {
    const result = await client.query<CustomerRow>(
      `UPDATE trading_partners.customer SET
         credit_limit = COALESCE($3, credit_limit),
         payment_terms_days = COALESCE($4, payment_terms_days),
         finance_charge_rate_monthly = COALESCE($5, finance_charge_rate_monthly),
         finance_charge_grace_days = COALESCE($6, finance_charge_grace_days),
         credit_hold = COALESCE($7, credit_hold),
         credit_hold_reason = CASE WHEN COALESCE($7, credit_hold) THEN COALESCE($8, credit_hold_reason) ELSE NULL END,
         finance_charge_rate_annual = COALESCE($9, finance_charge_rate_annual),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING id`,
      [
        id,
        expectedVersion,
        fields.creditLimit ?? null,
        fields.paymentTermsDays ?? null,
        fields.financeChargeRateMonthly ?? null,
        fields.financeChargeGraceDays ?? null,
        fields.creditHold ?? null,
        fields.creditHoldReason ?? null,
        fields.financeChargeRateAnnual ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Customer', id);
    }
    return (await this.findByIdWithClient(client, id))!;
  }

  /** A new QR for the shop: the old printout stops matching. */
  async newQrWithClient(client: PoolClient, id: string): Promise<CustomerRecord | null> {
    const result = await client.query<CustomerRow>(
      `UPDATE trading_partners.customer
       SET qr_token = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)), version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [id],
    );
    return result.rows[0] ? this.findByIdWithClient(client, id) : null;
  }

  async setStatusWithClient(
    client: PoolClient,
    id: string,
    status: 'active' | 'archived',
  ): Promise<CustomerRecord | null> {
    const result = await client.query<CustomerRow>(
      `UPDATE trading_partners.customer SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [id, status],
    );
    return result.rows[0] ? this.findByIdWithClient(client, id) : null;
  }
}
