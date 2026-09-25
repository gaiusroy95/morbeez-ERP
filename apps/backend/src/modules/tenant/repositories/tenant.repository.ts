import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { TenantRecord } from '../entities/tenant.entity';

interface TenantRow {
  id: string;
  name: string;
  plan: string;
  currency: string;
  timezone: string;
  tax_registration: string | null;
  branding: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function toTenantRecord(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    currency: row.currency,
    timezone: row.timezone,
    taxRegistration: row.tax_registration,
    branding: row.branding,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// tenant.tenant carries no tenant_id and has no RLS policy — it IS the
// tenant (Production Database, Section 01). That makes it the one table
// in the system where "which row am I allowed to touch" is enforced by
// the application, not the database: every caller into this repository
// must already know which id it's allowed to operate on (the
// authenticated caller's own tenantId), never an id taken from a request
// body or query param (Constitution IV.2). TenantService and
// TenantController are what make that true — this repository trusts
// whatever id it's given.
@Injectable()
export class TenantRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string): Promise<TenantRecord | null> {
    const result = await this.db.query<TenantRow>(
      'SELECT * FROM tenant.tenant WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toTenantRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    name: string,
    currency: string,
    timezone: string,
  ): Promise<TenantRecord> {
    const result = await client.query<TenantRow>(
      `INSERT INTO tenant.tenant (name, currency, timezone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, currency, timezone],
    );
    return toTenantRecord(result.rows[0]);
  }

  /** Cleanup for a signup attempt that failed after the tenant row was created but before it had a usable owner. */
  async deleteById(id: string): Promise<void> {
    await this.db.query('DELETE FROM tenant.tenant WHERE id = $1', [id]);
  }

  async update(
    id: string,
    fields: Partial<Pick<TenantRecord, 'name' | 'currency' | 'timezone' | 'taxRegistration'>>,
  ): Promise<TenantRecord | null> {
    const result = await this.db.query<TenantRow>(
      `UPDATE tenant.tenant SET
         name = COALESCE($2, name),
         currency = COALESCE($3, currency),
         timezone = COALESCE($4, timezone),
         tax_registration = COALESCE($5, tax_registration),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, fields.name, fields.currency, fields.timezone, fields.taxRegistration],
    );
    return result.rows[0] ? toTenantRecord(result.rows[0]) : null;
  }
}
