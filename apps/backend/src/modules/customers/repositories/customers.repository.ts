import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { CustomerRecord, CustomerTermsVersion } from '../entities/customer.entity';

interface CustomerRow {
  id: string;
  tenant_id: string;
  name: string;
  contact: Record<string, unknown>;
  place: string | null;
  address: string | null;
  landmark: string | null;
  shop_photo_key: string | null;
  shop_photo_type: string | null;
  shop_photo_at: Date | null;
  route_id: string | null;
  preferred_language: string;
  credit_limit: string;
  payment_terms_days: number;
  finance_charge_rate_monthly: string;
  finance_charge_rate_annual: string;
  finance_charge_grace_days: number;
  credit_hold: boolean;
  credit_hold_reason: string | null;
  finance_charge_enabled: boolean;
  bill_to_bill: boolean;
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
    landmark: row.landmark ?? null,
    // Whether there is a photo and when — never where it is kept.
    shopPhoto: row.shop_photo_at ? { uploadedAt: row.shop_photo_at } : null,
    routeId: row.route_id ?? null,
    preferredLanguage: row.preferred_language ?? 'en',
    creditLimit: row.credit_limit,
    paymentTermsDays: row.payment_terms_days,
    financeChargeRateMonthly: row.finance_charge_rate_monthly,
    financeChargeRateAnnual: row.finance_charge_rate_annual ?? '0.00',
    financeChargeGraceDays: row.finance_charge_grace_days,
    creditHold: row.credit_hold,
    creditHoldReason: row.credit_hold_reason,
    financeChargeEnabled: row.finance_charge_enabled,
    billToBill: row.bill_to_bill,
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
      landmark?: string | null;
      financeChargeEnabled?: boolean;
      financeChargeRateAnnual?: number;
      financeChargeRateMonthly?: number;
      financeChargeGraceDays?: number;
    },
  ): Promise<CustomerRecord> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO trading_partners.customer
         (tenant_id, name, contact, credit_limit, payment_terms_days, created_by, preferred_language, place, address, landmark,
          finance_charge_enabled, finance_charge_rate_annual, finance_charge_rate_monthly, finance_charge_grace_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        fields.landmark ?? null,
        fields.financeChargeEnabled ?? false,
        fields.financeChargeRateAnnual ?? 0,
        fields.financeChargeRateMonthly ?? 0,
        fields.financeChargeGraceDays ?? 0,
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
      landmark: string | null;
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
         landmark = CASE WHEN $11::boolean THEN $12 ELSE landmark END,
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
        'landmark' in fields,
        fields.landmark ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Customer', id);
    }
    return (await this.findByIdWithClient(client, id))!;
  }

  /**
   * The shop's front photo, replacing any earlier one. Not a change of the
   * customer's details, so no version step: a details form open meanwhile
   * still saves.
   */
  async setShopPhotoWithClient(client: PoolClient, id: string, key: string, contentType: string): Promise<CustomerRecord | null> {
    const r = await client.query(
      `UPDATE trading_partners.customer SET shop_photo_key = $2, shop_photo_type = $3, shop_photo_at = now(), updated_at = now() WHERE id = $1`,
      [id, key, contentType],
    );
    return r.rowCount ? this.findByIdWithClient(client, id) : null;
  }

  /** Where the shop's photo is kept, for serving it. */
  async shopPhotoWithClient(client: PoolClient, id: string): Promise<{ key: string; contentType: string } | null> {
    const r = await client.query<{ shop_photo_key: string | null; shop_photo_type: string | null }>(
      'SELECT shop_photo_key, shop_photo_type FROM trading_partners.customer WHERE id = $1',
      [id],
    );
    const row = r.rows[0];
    return row?.shop_photo_key && row.shop_photo_type ? { key: row.shop_photo_key, contentType: row.shop_photo_type } : null;
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
      financeChargeEnabled?: boolean;
      billToBill?: boolean;
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
         finance_charge_enabled = COALESCE($10, finance_charge_enabled),
         bill_to_bill = COALESCE($11, bill_to_bill),
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
        fields.financeChargeEnabled ?? null,
        fields.billToBill ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Customer', id);
    }
    return (await this.findByIdWithClient(client, id))!;
  }

  /**
   * BD.4: a bad debt written off puts the customer on hold for a review of
   * their terms. Not optimistic — a control the system applies, whatever
   * version the caller last read.
   */
  async holdForReviewWithClient(client: PoolClient, id: string, reason: string): Promise<CustomerRecord> {
    const result = await client.query(
      `UPDATE trading_partners.customer SET credit_hold = true, credit_hold_reason = $2, version = version + 1, updated_at = now()
        WHERE id = $1`,
      [id, reason],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Customer', id);
    return (await this.findByIdWithClient(client, id))!;
  }

  /** The terms now in force, kept as a dated version (Master Spec v3 P6, F6) — never overwritten. */
  async recordTermsVersionWithClient(client: PoolClient, id: string, source: 'created' | 'terms' | 'write_off', changedBy: string): Promise<void> {
    await client.query(
      `INSERT INTO trading_partners.customer_terms_version
         (tenant_id, customer_id, version, credit_limit, payment_terms_days, bill_to_bill, finance_charge_enabled,
          finance_charge_rate_annual, finance_charge_grace_days, credit_hold, credit_hold_reason, source, changed_by)
       SELECT tenant_id, id, version, credit_limit, payment_terms_days, bill_to_bill, finance_charge_enabled,
              finance_charge_rate_annual, finance_charge_grace_days, credit_hold, credit_hold_reason, $2, $3
         FROM trading_partners.customer WHERE id = $1`,
      [id, source, changedBy],
    );
  }

  async termsHistoryWithClient(client: PoolClient, id: string): Promise<CustomerTermsVersion[]> {
    const result = await client.query<{
      version: number;
      credit_limit: string;
      payment_terms_days: number;
      bill_to_bill: boolean;
      finance_charge_enabled: boolean;
      finance_charge_rate_annual: string;
      finance_charge_grace_days: number;
      credit_hold: boolean;
      credit_hold_reason: string | null;
      source: CustomerTermsVersion['source'];
      effective_from: Date;
      changed_by_login: string | null;
    }>(
      `SELECT v.version, v.credit_limit::text AS credit_limit, v.payment_terms_days, v.bill_to_bill, v.finance_charge_enabled,
              v.finance_charge_rate_annual::text AS finance_charge_rate_annual, v.finance_charge_grace_days, v.credit_hold,
              v.credit_hold_reason, v.source, v.effective_from, COALESCE(u.email::text, u.phone) AS changed_by_login
         FROM trading_partners.customer_terms_version v
         LEFT JOIN identity.app_user u ON u.id = v.changed_by
        WHERE v.customer_id = $1
        ORDER BY v.version DESC
        LIMIT 100`,
      [id],
    );
    return result.rows.map((r) => ({
      version: r.version,
      creditLimit: r.credit_limit,
      paymentTermsDays: r.payment_terms_days,
      billToBill: r.bill_to_bill,
      financeChargeEnabled: r.finance_charge_enabled,
      financeChargeRateAnnual: r.finance_charge_rate_annual,
      financeChargeGraceDays: r.finance_charge_grace_days,
      creditHold: r.credit_hold,
      creditHoldReason: r.credit_hold_reason,
      source: r.source,
      effectiveFrom: r.effective_from,
      changedBy: r.changed_by_login,
    }));
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
