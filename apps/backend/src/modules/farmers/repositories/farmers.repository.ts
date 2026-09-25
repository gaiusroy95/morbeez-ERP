import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { BankDetails, FarmerRecord } from '../entities/farmer.entity';
import { Env } from '../../../config/env.validation';

interface FarmerRow {
  id: string;
  tenant_id: string;
  name: string;
  contact: Record<string, unknown>;
  bank_details_decrypted: string | null; // present only when the query explicitly decrypts it
  reliability_rating: string | null;
  status: 'active' | 'archived';
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: FarmerRow): FarmerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    contact: row.contact ?? {},
    // null: the farmer genuinely has no bank details on file yet.
    // list() overrides this to `undefined` afterward — decryption never
    // runs for a list query in the first place (see list()'s comment).
    bankDetails: row.bank_details_decrypted
      ? (JSON.parse(row.bank_details_decrypted) as BankDetails)
      : null,
    reliabilityRating: row.reliability_rating,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class FarmersRepository {
  private readonly encryptionKey: string;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.encryptionKey = config.get('FIELD_ENCRYPTION_KEY', { infer: true });
  }

  /**
   * List never decrypts bank_details — a farmer list screen has no
   * business reading payout details for every row, and pgp_sym_decrypt
   * isn't free at scale. Only findById (a single record, an explicit
   * "view this farmer" action) decrypts it.
   */
  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<FarmerRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<FarmerRow>(
          `SELECT id, tenant_id, name, contact, NULL AS bank_details_decrypted,
                  reliability_rating, status, version, created_at, updated_at, created_by
           FROM trading_partners.farmer
           ORDER BY name
           LIMIT $1 OFFSET $2`,
          [size, offset],
        ),
        client.query<{ count: string }>('SELECT count(*) FROM trading_partners.farmer'),
      ]);
      return {
        items: rows.rows.map((r) => ({ ...toRecord(r), bankDetails: undefined })),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<FarmerRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<FarmerRecord | null> {
    const result = await client.query<FarmerRow>(
      `SELECT id, tenant_id, name, contact,
              CASE WHEN bank_details_encrypted IS NULL THEN NULL
                   ELSE pgp_sym_decrypt(bank_details_encrypted, $2) END AS bank_details_decrypted,
              reliability_rating, status, version, created_at, updated_at, created_by
       FROM trading_partners.farmer
       WHERE id = $1`,
      [id, this.encryptionKey],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: { name: string; contact: Record<string, unknown>; bankDetails?: BankDetails },
  ): Promise<FarmerRecord> {
    // Same shape regardless of whether bankDetails is present — a fixed
    // parameter count/order that doesn't depend on building the SQL text
    // conditionally, unlike an earlier draft of this method that
    // interpolated the placeholder numbering itself and was one edit away
    // from silently misaligning params.
    const result = await client.query<FarmerRow>(
      `INSERT INTO trading_partners.farmer
         (tenant_id, name, contact, bank_details_encrypted, created_by)
       VALUES (
         $1, $2, $3,
         CASE WHEN $4::text IS NULL THEN NULL ELSE pgp_sym_encrypt($4, $5) END,
         $6
       )
       RETURNING id, tenant_id, name, contact, NULL AS bank_details_decrypted,
                 reliability_rating, status, version, created_at, updated_at, created_by`,
      [
        tenantId,
        fields.name,
        JSON.stringify(fields.contact),
        fields.bankDetails ? JSON.stringify(fields.bankDetails) : null,
        this.encryptionKey,
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
  }

  async updateWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: Partial<{
      name: string;
      contact: Record<string, unknown>;
      bankDetails: BankDetails;
      reliabilityRating: number;
    }>,
  ): Promise<FarmerRecord> {
    const result = await client.query<FarmerRow>(
      `UPDATE trading_partners.farmer SET
         name = COALESCE($3, name),
         contact = COALESCE($4, contact),
         bank_details_encrypted = CASE WHEN $5::text IS NULL THEN bank_details_encrypted ELSE pgp_sym_encrypt($5, $6) END,
         reliability_rating = COALESCE($7, reliability_rating),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING id, tenant_id, name, contact, NULL AS bank_details_decrypted,
                 reliability_rating, status, version, created_at, updated_at, created_by`,
      [
        id,
        expectedVersion,
        fields.name,
        fields.contact ? JSON.stringify(fields.contact) : null,
        fields.bankDetails ? JSON.stringify(fields.bankDetails) : null,
        this.encryptionKey,
        fields.reliabilityRating,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Farmer', id);
    }
    return toRecord(result.rows[0]);
  }

  async setStatusWithClient(
    client: PoolClient,
    id: string,
    status: 'active' | 'archived',
  ): Promise<FarmerRecord | null> {
    const result = await client.query<FarmerRow>(
      `UPDATE trading_partners.farmer SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING id, tenant_id, name, contact, NULL AS bank_details_decrypted,
                 reliability_rating, status, version, created_at, updated_at, created_by`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
