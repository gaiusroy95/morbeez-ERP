import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { ProductKind, ProductRecord, UnitOfMeasure } from '../entities/product.entity';

interface ProductRow {
  id: string;
  tenant_id: string;
  name: string;
  category: string | null;
  base_uom: UnitOfMeasure;
  base_price: string | null;
  kind: ProductKind;
  pack_size: number | null;
  loss_tolerance_pct: string | null;
  status: 'active' | 'archived';
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category,
    baseUom: row.base_uom,
    basePrice: row.base_price,
    kind: row.kind ?? 'standard',
    packSize: row.pack_size ?? null,
    lossTolerancePct: row.loss_tolerance_pct ?? null,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ProductRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<ProductRow>(
          `SELECT * FROM trading_partners.product ORDER BY name LIMIT $1 OFFSET $2`,
          [size, offset],
        ),
        client.query<{ count: string }>('SELECT count(*) FROM trading_partners.product'),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<ProductRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<ProductRecord | null> {
    const result = await client.query<ProductRow>(
      'SELECT * FROM trading_partners.product WHERE id = $1',
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
      category?: string;
      baseUom: string;
      basePrice: number | null;
      kind: ProductKind;
      packSize: number | null;
      lossTolerancePct: number | null;
    },
  ): Promise<ProductRecord> {
    const result = await client.query<ProductRow>(
      `INSERT INTO trading_partners.product
         (tenant_id, name, category, base_uom, base_price, created_by, kind, pack_size, loss_tolerance_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tenantId,
        fields.name,
        fields.category ?? null,
        fields.baseUom,
        fields.basePrice,
        createdBy,
        fields.kind,
        fields.packSize,
        fields.lossTolerancePct,
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
      category: string;
      baseUom: string;
      basePrice: number | null;
      packSize: number;
      lossTolerancePct: number | null;
    }>,
  ): Promise<ProductRecord> {
    // null clears basePrice / lossTolerancePct; undefined leaves them be.
    const result = await client.query<ProductRow>(
      `UPDATE trading_partners.product SET
         name = COALESCE($3, name),
         category = COALESCE($4, category),
         base_uom = COALESCE($5, base_uom),
         base_price = CASE WHEN $7 THEN $6::numeric ELSE base_price END,
         pack_size = COALESCE($8, pack_size),
         loss_tolerance_pct = CASE WHEN $10 THEN $9::numeric ELSE loss_tolerance_pct END,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.name,
        fields.category,
        fields.baseUom,
        fields.basePrice ?? null,
        fields.basePrice !== undefined,
        fields.packSize,
        fields.lossTolerancePct ?? null,
        fields.lossTolerancePct !== undefined,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Product', id);
    }
    return toRecord(result.rows[0]);
  }

  async setStatusWithClient(
    client: PoolClient,
    id: string,
    status: 'active' | 'archived',
  ): Promise<ProductRecord | null> {
    const result = await client.query<ProductRow>(
      `UPDATE trading_partners.product SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
