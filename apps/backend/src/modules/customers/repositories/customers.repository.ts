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
  credit_limit: string;
  payment_terms_days: number;
  finance_charge_rate_monthly: string;
  finance_charge_grace_days: number;
  credit_hold: boolean;
  credit_hold_reason: string | null;
  status: 'active' | 'archived';
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    contact: row.contact ?? {},
    creditLimit: row.credit_limit,
    paymentTermsDays: row.payment_terms_days,
    financeChargeRateMonthly: row.finance_charge_rate_monthly,
    financeChargeGraceDays: row.finance_charge_grace_days,
    creditHold: row.credit_hold,
    creditHoldReason: row.credit_hold_reason,
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
          `SELECT * FROM trading_partners.customer
           ORDER BY name
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
    const result = await client.query<CustomerRow>(
      'SELECT * FROM trading_partners.customer WHERE id = $1',
      [id],
    );
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
    },
  ): Promise<CustomerRecord> {
    const result = await client.query<CustomerRow>(
      `INSERT INTO trading_partners.customer
         (tenant_id, name, contact, credit_limit, payment_terms_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        fields.name,
        JSON.stringify(fields.contact),
        fields.creditLimit,
        fields.paymentTermsDays,
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
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
    }>,
  ): Promise<CustomerRecord> {
    const result = await client.query<CustomerRow>(
      `UPDATE trading_partners.customer SET
         name = COALESCE($3, name),
         contact = COALESCE($4, contact),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.name,
        fields.contact ? JSON.stringify(fields.contact) : null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Customer', id);
    }
    return toRecord(result.rows[0]);
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
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.creditLimit ?? null,
        fields.paymentTermsDays ?? null,
        fields.financeChargeRateMonthly ?? null,
        fields.financeChargeGraceDays ?? null,
        fields.creditHold ?? null,
        fields.creditHoldReason ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Customer', id);
    }
    return toRecord(result.rows[0]);
  }

  async setStatusWithClient(
    client: PoolClient,
    id: string,
    status: 'active' | 'archived',
  ): Promise<CustomerRecord | null> {
    const result = await client.query<CustomerRow>(
      `UPDATE trading_partners.customer SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
