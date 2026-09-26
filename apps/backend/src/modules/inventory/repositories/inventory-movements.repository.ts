import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { InventoryMovementRecord, MovementType } from '../entities/inventory-movement.entity';

interface InventoryMovementRow {
  id: string;
  tenant_id: string;
  lot_id: string;
  product_id: string;
  movement_type: MovementType;
  quantity: string;
  reason: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  created_at: Date;
  created_by: string;
}

function toRecord(row: InventoryMovementRow): InventoryMovementRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lotId: row.lot_id,
    productId: row.product_id,
    movementType: row.movement_type,
    quantity: row.quantity,
    reason: row.reason,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class InventoryMovementsRepository {
  constructor(private readonly db: DatabaseService) {}

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      lotId: string;
      productId: string;
      movementType: MovementType;
      quantity: number;
      reason?: string | null;
      fromLocationId?: string | null;
      toLocationId?: string | null;
    },
  ): Promise<InventoryMovementRecord> {
    const result = await client.query<InventoryMovementRow>(
      `INSERT INTO stock.inventory_movement
         (tenant_id, lot_id, product_id, movement_type, quantity, reason, from_location_id, to_location_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tenantId,
        fields.lotId,
        fields.productId,
        fields.movementType,
        fields.quantity,
        fields.reason ?? null,
        fields.fromLocationId ?? null,
        fields.toLocationId ?? null,
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
  }

  listByLot(tenantId: string, lotId: string, page: number, pageSize: number): Promise<PaginatedResult<InventoryMovementRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<InventoryMovementRow>(
          `SELECT * FROM stock.inventory_movement WHERE lot_id = $3 ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [size, offset, lotId],
        ),
        client.query<{ count: string }>('SELECT count(*) FROM stock.inventory_movement WHERE lot_id = $1', [lotId]),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  listByProduct(
    tenantId: string,
    productId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<InventoryMovementRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<InventoryMovementRow>(
          `SELECT * FROM stock.inventory_movement WHERE product_id = $3 ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [size, offset, productId],
        ),
        client.query<{ count: string }>('SELECT count(*) FROM stock.inventory_movement WHERE product_id = $1', [
          productId,
        ]),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }
}
