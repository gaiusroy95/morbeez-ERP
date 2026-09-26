import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { LotRecord, LotStatus, ProductStockRow } from '../entities/lot.entity';

interface LotRow {
  id: string;
  tenant_id: string;
  purchase_order_id: string;
  farmer_id: string;
  product_id: string;
  pickup_id: string | null;
  received_quantity: string;
  accepted_quantity: string | null;
  rejected_quantity: string | null;
  grade: string | null;
  rejection_reason: string | null;
  unit_cost: string | null;
  status: LotStatus;
  reserved_for_order_line_id: string | null;
  current_quantity: string | null;
  current_location_id: string | null;
  received_at: Date;
  graded_at: Date | null;
  graded_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: LotRow): LotRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    purchaseOrderId: row.purchase_order_id,
    farmerId: row.farmer_id,
    productId: row.product_id,
    pickupId: row.pickup_id,
    receivedQuantity: row.received_quantity,
    acceptedQuantity: row.accepted_quantity,
    rejectedQuantity: row.rejected_quantity,
    grade: row.grade,
    rejectionReason: row.rejection_reason,
    unitCost: row.unit_cost,
    status: row.status,
    reservedForOrderLineId: row.reserved_for_order_line_id,
    currentQuantity: row.current_quantity,
    currentLocationId: row.current_location_id,
    receivedAt: row.received_at,
    gradedAt: row.graded_at,
    gradedBy: row.graded_by,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class LotsRepository {
  constructor(private readonly db: DatabaseService) {}

  listByPurchaseOrder(tenantId: string, purchaseOrderId: string): Promise<LotRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.listByPurchaseOrderWithClient(client, purchaseOrderId));
  }

  async listByPurchaseOrderWithClient(client: PoolClient, purchaseOrderId: string): Promise<LotRecord[]> {
    const result = await client.query<LotRow>(
      'SELECT * FROM commerce.lot WHERE purchase_order_id = $1 ORDER BY received_at',
      [purchaseOrderId],
    );
    return result.rows.map(toRecord);
  }

  findById(tenantId: string, id: string): Promise<LotRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<LotRecord | null> {
    const result = await client.query<LotRow>('SELECT * FROM commerce.lot WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      purchaseOrderId: string;
      farmerId: string;
      productId: string;
      pickupId: string | null;
      receivedQuantity: number;
    },
  ): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `INSERT INTO commerce.lot
         (tenant_id, purchase_order_id, farmer_id, product_id, pickup_id, received_quantity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        fields.purchaseOrderId,
        fields.farmerId,
        fields.productId,
        fields.pickupId,
        fields.receivedQuantity,
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
  }

  /**
   * Grading fixes unit_cost for good (Accounting Engine LOT.2). The DB's
   * lot_grading_reconciles / lot_unit_cost_set_iff_graded CHECK constraints
   * are the real enforcement; this just supplies values shaped to satisfy them.
   */
  async gradeWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    gradedBy: string,
    fields: {
      acceptedQuantity: number;
      rejectedQuantity: number;
      grade: string | null;
      rejectionReason: string | null;
      unitCost: number | null;
    },
  ): Promise<LotRecord> {
    const status: LotStatus = fields.acceptedQuantity > 0 ? 'available' : 'rejected';
    // current_quantity — the Inventory Engine's running balance — starts
    // at whatever was accepted, including 0 for a fully rejected lot.
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot SET
         accepted_quantity = $3,
         rejected_quantity = $4,
         grade = $5,
         rejection_reason = $6,
         unit_cost = $7,
         status = $8,
         current_quantity = $3,
         graded_at = now(),
         graded_by = $9,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'received_ungraded'
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.acceptedQuantity,
        fields.rejectedQuantity,
        fields.grade,
        fields.rejectionReason,
        fields.unitCost,
        status,
        gradedBy,
      ],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
  }

  async countUngradedWithClient(client: PoolClient, purchaseOrderId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*) FROM commerce.lot WHERE purchase_order_id = $1 AND status = 'received_ungraded'`,
      [purchaseOrderId],
    );
    return Number(result.rows[0].count);
  }

  async countUnsettledAvailableWithClient(client: PoolClient, purchaseOrderId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*) FROM commerce.lot l
       WHERE l.purchase_order_id = $1 AND l.status = 'available'
         AND NOT EXISTS (SELECT 1 FROM money.farmer_settlement s WHERE s.lot_id = l.id)`,
      [purchaseOrderId],
    );
    return Number(result.rows[0].count);
  }

  /**
   * Locks every available lot for this product, oldest received_at first
   * (FEFO), so that reserveWithClient — called immediately after, in the
   * same transaction — can claim whole lots against this exact snapshot
   * without a second caller racing in between. FOR UPDATE means a
   * concurrent reservation attempt against the same product blocks here
   * until this transaction commits or rolls back, then re-reads current
   * (post-commit) rows — never stale ones.
   */
  async lockAvailableForProductWithClient(
    client: PoolClient,
    tenantId: string,
    productId: string,
  ): Promise<LotRecord[]> {
    const result = await client.query<LotRow>(
      `SELECT * FROM commerce.lot
       WHERE tenant_id = $1 AND product_id = $2 AND status = 'available' AND current_quantity > 0
       ORDER BY received_at ASC
       FOR UPDATE`,
      [tenantId, productId],
    );
    return result.rows.map(toRecord);
  }

  async reserveWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    orderLineId: string,
  ): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot SET
         status = 'reserved',
         reserved_for_order_line_id = $3,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'available'
       RETURNING *`,
      [id, expectedVersion, orderLineId],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
  }

  listReservedForOrderLine(tenantId: string, orderLineId: string): Promise<LotRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.listReservedForOrderLineWithClient(client, orderLineId));
  }

  async listReservedForOrderLineWithClient(client: PoolClient, orderLineId: string): Promise<LotRecord[]> {
    const result = await client.query<LotRow>(
      `SELECT * FROM commerce.lot WHERE reserved_for_order_line_id = $1`,
      [orderLineId],
    );
    return result.rows.map(toRecord);
  }

  async releaseWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot SET
         status = 'available',
         reserved_for_order_line_id = NULL,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'reserved'
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
  }

  /** reserved -> delivered once the order the lot was reserved for reaches the customer. */
  async consumeWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot SET status = 'delivered', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'reserved'
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
  }

  /** One row per product that has ever had a lot — the whole stock picture in one query. */
  stockByProduct(tenantId: string): Promise<ProductStockRow[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<{
        product_id: string;
        available: string;
        reserved: string;
        physical: string;
        value_at_cost: string;
        available_lots: number;
        ungraded_lots: number;
        ungraded_quantity: string;
        oldest_available_received_at: Date | null;
      }>(
        `SELECT product_id,
                ROUND(COALESCE(SUM(current_quantity) FILTER (WHERE status = 'available'), 0), 3)::text AS available,
                ROUND(COALESCE(SUM(current_quantity) FILTER (WHERE status = 'reserved'), 0), 3)::text AS reserved,
                ROUND(COALESCE(SUM(current_quantity) FILTER (WHERE status IN ('available', 'reserved')), 0), 3)::text AS physical,
                ROUND(COALESCE(SUM(current_quantity * unit_cost) FILTER (WHERE status IN ('available', 'reserved')), 0), 2)::text AS value_at_cost,
                (count(*) FILTER (WHERE status = 'available' AND current_quantity > 0))::int AS available_lots,
                (count(*) FILTER (WHERE status = 'received_ungraded'))::int AS ungraded_lots,
                ROUND(COALESCE(SUM(received_quantity) FILTER (WHERE status = 'received_ungraded'), 0), 3)::text AS ungraded_quantity,
                min(received_at) FILTER (WHERE status = 'available' AND current_quantity > 0) AS oldest_available_received_at
         FROM commerce.lot
         GROUP BY product_id`,
      );
      return result.rows.map((row) => ({
        productId: row.product_id,
        available: row.available,
        reserved: row.reserved,
        physical: row.physical,
        valueAtCost: row.value_at_cost,
        availableLots: row.available_lots,
        ungradedLots: row.ungraded_lots,
        ungradedQuantity: row.ungraded_quantity,
        oldestAvailableReceivedAt: row.oldest_available_received_at,
      }));
    });
  }

  /** Every graded lot for this product, any status — the raw data the Inventory Engine's stock summary is computed from. */
  listForProduct(tenantId: string, productId: string): Promise<LotRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.listForProductWithClient(client, tenantId, productId));
  }

  async listForProductWithClient(client: PoolClient, tenantId: string, productId: string): Promise<LotRecord[]> {
    const result = await client.query<LotRow>(
      `SELECT * FROM commerce.lot WHERE tenant_id = $1 AND product_id = $2 AND graded_at IS NOT NULL
       ORDER BY received_at ASC`,
      [tenantId, productId],
    );
    return result.rows.map(toRecord);
  }

  /**
   * Draws down current_quantity by `quantity` — shrinkage and a
   * post-acceptance rejection are the same mechanical update, just
   * recorded under a different reason by the caller (ProcurementService);
   * `terminalStatus` is what the lot becomes if this draws it to exactly
   * zero (unchanged — 'available' — for shrinkage; 'rejected' for a
   * quality rejection).
   */
  async drawDownWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    quantity: number,
    terminalStatus: LotStatus,
  ): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot SET
         current_quantity = current_quantity - $3,
         status = CASE WHEN current_quantity - $3 <= 0 THEN $4 ELSE status END,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'available' AND current_quantity >= $3
       RETURNING *`,
      [id, expectedVersion, quantity, terminalStatus],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
  }

  async transferWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    toLocationId: string,
  ): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot SET
         current_location_id = $3,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'available'
       RETURNING *`,
      [id, expectedVersion, toLocationId],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
  }
}
