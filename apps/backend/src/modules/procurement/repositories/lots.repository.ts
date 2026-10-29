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
  current_quantity: string | null;
  reserved_quantity: string;
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
    currentQuantity: row.current_quantity,
    reservedQuantity: row.reserved_quantity,
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

// Where a lot is (its one place, or null when it's in the store or split
// across places) and how much of it is held for orders — from its balances.
const LOT_COLUMNS = `l.*,
  (SELECT CASE WHEN count(DISTINCT b.location_id) = 1 AND bool_and(b.location_id IS NOT NULL) THEN (array_agg(b.location_id))[1] END
     FROM stock.lot_balance b WHERE b.lot_id = l.id AND b.quantity > 0) AS current_location_id,
  (SELECT COALESCE(SUM(b.reserved_quantity), 0)::numeric(12,3)::text FROM stock.lot_balance b WHERE b.lot_id = l.id) AS reserved_quantity`;

@Injectable()
export class LotsRepository {
  constructor(private readonly db: DatabaseService) {}

  listByPurchaseOrder(tenantId: string, purchaseOrderId: string): Promise<LotRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.listByPurchaseOrderWithClient(client, purchaseOrderId));
  }

  async listByPurchaseOrderWithClient(client: PoolClient, purchaseOrderId: string): Promise<LotRecord[]> {
    const result = await client.query<LotRow>(
      `SELECT ${LOT_COLUMNS} FROM commerce.lot l WHERE l.purchase_order_id = $1 ORDER BY l.received_at`,
      [purchaseOrderId],
    );
    return result.rows.map(toRecord);
  }

  findById(tenantId: string, id: string): Promise<LotRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<LotRecord | null> {
    const result = await client.query<LotRow>(`SELECT ${LOT_COLUMNS} FROM commerce.lot l WHERE l.id = $1`, [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** The lot at the version the caller read, locked for the rest of the transaction. */
  async lockWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `SELECT ${LOT_COLUMNS} FROM commerce.lot l WHERE l.id = $1 AND l.version = $2 FOR UPDATE OF l`,
      [id, expectedVersion],
    );
    if (!result.rows[0]) throw new OptimisticLockException('Lot', id);
    return toRecord(result.rows[0]);
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
      `INSERT INTO commerce.lot AS l
         (tenant_id, purchase_order_id, farmer_id, product_id, pickup_id, received_quantity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${LOT_COLUMNS}`,
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
    // at whatever was accepted, including 0 for a fully rejected lot. The
    // caller puts the accepted kilos in a place (stock.lot_balance).
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot AS l SET
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
       RETURNING ${LOT_COLUMNS}`,
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

  /**
   * After a quality write-off: a lot it emptied is 'rejected', the same
   * terminal state grading-time rejection produces. Shrinkage leaves an
   * empty lot 'available' — it isn't a quality verdict.
   */
  async markEmptyAsWithClient(client: PoolClient, id: string, status: LotStatus): Promise<void> {
    await client.query(
      `UPDATE commerce.lot SET status = $2, updated_at = now() WHERE id = $1 AND status = 'available' AND current_quantity <= 0`,
      [id, status],
    );
  }

  /** A change to where a lot's kilos are is a change to the lot: its version moves on. */
  async touchWithClient(client: PoolClient, id: string): Promise<LotRecord> {
    const result = await client.query<LotRow>(
      `UPDATE commerce.lot AS l SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING ${LOT_COLUMNS}`,
      [id],
    );
    return toRecord(result.rows[0]);
  }

  /**
   * One row per product that has ever had a lot — the whole stock picture
   * in one query. Kilos are counted where they are (stock.lot_balance):
   * physical is everything, on vehicles included; reserved is what's held
   * for orders; available is the rest.
   */
  stockByProduct(tenantId: string): Promise<ProductStockRow[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<{
        product_id: string;
        available: string;
        reserved: string;
        physical: string;
        on_vehicles: string;
        value_at_cost: string;
        available_lots: number;
        ungraded_lots: number;
        ungraded_quantity: string;
        oldest_available_received_at: Date | null;
      }>(
        `WITH placed AS (
           SELECT b.product_id,
                  SUM(b.quantity - b.reserved_quantity) AS available,
                  SUM(b.reserved_quantity) AS reserved,
                  SUM(b.quantity) AS physical,
                  SUM(b.quantity) FILTER (WHERE loc.id IS NOT NULL) AS on_vehicles,
                  SUM(b.quantity * l.unit_cost) AS value_at_cost,
                  count(DISTINCT b.lot_id) FILTER (WHERE b.quantity > b.reserved_quantity) AS available_lots,
                  min(l.received_at) FILTER (WHERE b.quantity > b.reserved_quantity) AS oldest
           FROM stock.lot_balance b
           JOIN commerce.lot l ON l.id = b.lot_id
           LEFT JOIN stock.location loc ON loc.id = b.location_id AND loc.type = 'vehicle'
           WHERE b.quantity > 0 AND l.status = 'available'
           GROUP BY b.product_id
         ), ungraded AS (
           SELECT product_id, count(*)::int AS lots, SUM(received_quantity) AS quantity
           FROM commerce.lot WHERE status = 'received_ungraded' GROUP BY product_id
         )
         SELECT p.product_id,
                ROUND(COALESCE(pl.available, 0), 3)::text AS available,
                ROUND(COALESCE(pl.reserved, 0), 3)::text AS reserved,
                ROUND(COALESCE(pl.physical, 0), 3)::text AS physical,
                ROUND(COALESCE(pl.on_vehicles, 0), 3)::text AS on_vehicles,
                ROUND(COALESCE(pl.value_at_cost, 0), 2)::text AS value_at_cost,
                COALESCE(pl.available_lots, 0)::int AS available_lots,
                COALESCE(u.lots, 0)::int AS ungraded_lots,
                ROUND(COALESCE(u.quantity, 0), 3)::text AS ungraded_quantity,
                pl.oldest AS oldest_available_received_at
         FROM (SELECT DISTINCT product_id FROM commerce.lot) p
         LEFT JOIN placed pl ON pl.product_id = p.product_id
         LEFT JOIN ungraded u ON u.product_id = p.product_id`,
      );
      return result.rows.map((row) => ({
        productId: row.product_id,
        available: row.available,
        reserved: row.reserved,
        physical: row.physical,
        onVehicles: row.on_vehicles,
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
      `SELECT ${LOT_COLUMNS} FROM commerce.lot l WHERE l.tenant_id = $1 AND l.product_id = $2 AND l.graded_at IS NOT NULL
       ORDER BY l.received_at ASC`,
      [tenantId, productId],
    );
    return result.rows.map(toRecord);
  }

  /** An egg lot's breakage at grading against the owner's tolerance; null for anything but eggs. */
  async breakageWithClient(
    client: PoolClient,
    lotId: string,
  ): Promise<{ product: string; farmer: string; received: string; rejected: string; pct: string; tolerance: string } | null> {
    const result = await client.query<{ product: string; farmer: string; received: string; rejected: string; pct: string; tolerance: string }>(
      `SELECT p.name AS product, f.name AS farmer, l.received_quantity::text AS received, l.rejected_quantity::text AS rejected,
              round(l.rejected_quantity * 100 / l.received_quantity, 2)::text AS pct,
              COALESCE(p.loss_tolerance_pct, t.default_breakage_tolerance_pct)::text AS tolerance
         FROM commerce.lot l
         JOIN trading_partners.product p ON p.id = l.product_id
         JOIN trading_partners.farmer f ON f.id = l.farmer_id
         JOIN tenant.tenant t ON t.id = l.tenant_id
        WHERE l.id = $1 AND p.kind = 'egg' AND l.received_quantity > 0`,
      [lotId],
    );
    return result.rows[0] ?? null;
  }
}
