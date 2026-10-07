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
  trial_ends_at: Date | null;
  subscribed_until: Date | null;
  operating_day_end: string;
  owner_away_until: Date | null;
  alert_cash_threshold: string;
  alert_collection_threshold: string;
  default_shrinkage_tolerance_pct: string;
  default_breakage_tolerance_pct: string;
  weighment_photo: 'optional' | 'required' | 'not_required';
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
    trialEndsAt: row.trial_ends_at ?? null,
    subscribedUntil: row.subscribed_until ?? null,
    operatingDayEnd: (row.operating_day_end ?? '22:00').slice(0, 5),
    ownerAwayUntil: row.owner_away_until ?? null,
    alertCashThreshold: row.alert_cash_threshold ?? '500.00',
    alertCollectionThreshold: row.alert_collection_threshold ?? '1000.00',
    defaultShrinkageTolerancePct: row.default_shrinkage_tolerance_pct ?? '2.00',
    defaultBreakageTolerancePct: row.default_breakage_tolerance_pct ?? '1.00',
    weighmentPhoto: row.weighment_photo ?? 'optional',
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

  /** [trialDays] null: no trial limit (a business the team sets up on its own terms). */
  async createWithClient(
    client: PoolClient,
    name: string,
    currency: string,
    timezone: string,
    trialDays: number | null = null,
  ): Promise<TenantRecord> {
    const result = await client.query<TenantRow>(
      `INSERT INTO tenant.tenant (name, currency, timezone, trial_ends_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END)
       RETURNING *`,
      [name, currency, timezone, trialDays],
    );
    return toTenantRecord(result.rows[0]);
  }

  /** Records a payment: paid through [until]. For the team (provision/subscription CLI), never a request body. */
  async setSubscribedUntil(id: string, until: Date | null): Promise<TenantRecord | null> {
    const result = await this.db.query<TenantRow>(
      'UPDATE tenant.tenant SET subscribed_until = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, until],
    );
    return result.rows[0] ? toTenantRecord(result.rows[0]) : null;
  }

  /** Cleanup for a signup attempt that failed after the tenant row was created but before it had a usable owner. */
  async deleteById(id: string): Promise<void> {
    await this.db.query('DELETE FROM tenant.tenant WHERE id = $1', [id]);
  }

  async update(
    id: string,
    fields: Partial<Pick<TenantRecord, 'name' | 'currency' | 'timezone' | 'taxRegistration' | 'operatingDayEnd'>> & {
      alertCashThreshold?: number;
      alertCollectionThreshold?: number;
      defaultShrinkageTolerancePct?: number;
      defaultBreakageTolerancePct?: number;
      weighmentPhoto?: string;
    },
  ): Promise<TenantRecord | null> {
    const result = await this.db.query<TenantRow>(
      `UPDATE tenant.tenant SET
         name = COALESCE($2, name),
         currency = COALESCE($3, currency),
         timezone = COALESCE($4, timezone),
         tax_registration = COALESCE($5, tax_registration),
         operating_day_end = COALESCE($6::time, operating_day_end),
         alert_cash_threshold = COALESCE($7, alert_cash_threshold),
         alert_collection_threshold = COALESCE($8, alert_collection_threshold),
         default_shrinkage_tolerance_pct = COALESCE($9, default_shrinkage_tolerance_pct),
         default_breakage_tolerance_pct = COALESCE($10, default_breakage_tolerance_pct),
         weighment_photo = COALESCE($11, weighment_photo),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        fields.name,
        fields.currency,
        fields.timezone,
        fields.taxRegistration,
        fields.operatingDayEnd,
        fields.alertCashThreshold,
        fields.alertCollectionThreshold,
        fields.defaultShrinkageTolerancePct,
        fields.defaultBreakageTolerancePct,
        fields.weighmentPhoto,
      ],
    );
    return result.rows[0] ? toTenantRecord(result.rows[0]) : null;
  }
}
