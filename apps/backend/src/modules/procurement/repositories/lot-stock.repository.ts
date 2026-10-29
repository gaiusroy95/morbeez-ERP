import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { toMilli } from '../../../common/quantity';

/**
 * A lot's kilos at one place (stock.lot_balance) — the store when
 * locationId is null or a warehouse, else a vehicle — with what the lot
 * cost and when it came in (oldest goes first).
 */
export interface BalanceRow {
  id: string;
  lotId: string;
  productId: string;
  locationId: string | null;
  /** The vehicle this place is, when it is one. */
  vehicleId: string | null;
  quantity: string;
  reserved: string;
  unitCost: string | null;
  receivedAt: Date;
}

/** An order line's claim on a balance (commerce.lot_allocation), with the balance. */
export interface HeldRow extends BalanceRow {
  allocationId: string;
  allocationReserved: string;
  allocationDelivered: string;
}

export interface VehicleStockRow {
  vehicleId: string;
  registrationNumber: string;
  productId: string;
  product: string;
  uom: string;
  onVehicle: string;
  reserved: string;
  valueAtCost: string;
}

export type StockMovementType =
  | 'loaded'
  | 'picked_up'
  | 'delivered'
  | 'returned'
  | 'spot_sold'
  | 'shrinkage'
  | 'rejected_post_acceptance'
  | 'transferred';

interface BalanceDbRow {
  id: string;
  lot_id: string;
  product_id: string;
  location_id: string | null;
  vehicle_id: string | null;
  quantity: string;
  reserved: string;
  unit_cost: string | null;
  received_at: Date;
}

const toBalance = (r: BalanceDbRow): BalanceRow => ({
  id: r.id,
  lotId: r.lot_id,
  productId: r.product_id,
  locationId: r.location_id,
  vehicleId: r.vehicle_id,
  quantity: r.quantity,
  reserved: r.reserved,
  unitCost: r.unit_cost,
  receivedAt: r.received_at,
});

const BALANCE_COLUMNS = `b.id, b.lot_id, b.product_id, b.location_id, loc.vehicle_id, b.quantity::text AS quantity,
  b.reserved_quantity::text AS reserved, l.unit_cost::text AS unit_cost, l.received_at`;
// loc is the balance's place only when that place is a vehicle.
const BALANCE_JOINS = `JOIN commerce.lot l ON l.id = b.lot_id
  LEFT JOIN stock.location loc ON loc.id = b.location_id AND loc.type = 'vehicle'`;
const FIFO = 'ORDER BY l.received_at, b.created_at, b.id';

/**
 * Stock by the kilo (driver app D0): where each lot's kilos are and which
 * order lines they're held for. Every change to a balance's quantity
 * changes its lot's current_quantity by the same amount, in the same
 * statement sequence, so a lot's total is always the sum of its places.
 */
@Injectable()
export class LotStockRepository {
  async createWithClient(
    client: PoolClient,
    tenantId: string,
    fields: { lotId: string; productId: string; locationId: string | null; quantity: string },
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO stock.lot_balance (tenant_id, lot_id, product_id, location_id, quantity)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, fields.lotId, fields.productId, fields.locationId, fields.quantity],
    );
    return r.rows[0].id;
  }

  /**
   * Locks just enough free kilos of a product at one place (the store when
   * vehicleId is null) to cover `quantity`, oldest first (Performance Audit
   * PA-03). Balances another transaction is holding are skipped, not waited
   * on; only if what's left can't cover the quantity does it wait for them.
   */
  async lockFreeWithClient(client: PoolClient, productId: string, quantity: string, vehicleId: string | null): Promise<BalanceRow[]> {
    const want = toMilli(quantity);
    const taken: BalanceRow[] = [];
    let covered = 0n;
    const next = async (skipLocked: boolean) => {
      const r = await client.query<BalanceDbRow>(
        `SELECT ${BALANCE_COLUMNS} FROM stock.lot_balance b ${BALANCE_JOINS}
         WHERE b.product_id = $1 AND l.status = 'available' AND b.quantity > b.reserved_quantity
           AND ${vehicleId ? 'loc.vehicle_id = $3' : 'loc.id IS NULL'}
           AND NOT (b.id = ANY($2::uuid[]))
         ${FIFO}
         LIMIT ${BATCH}
         FOR UPDATE OF b ${skipLocked ? 'SKIP LOCKED' : ''}`,
        vehicleId ? [productId, taken.map((b) => b.id), vehicleId] : [productId, taken.map((b) => b.id)],
      );
      return r.rows.map(toBalance);
    };
    for (const skipLocked of [true, false]) {
      for (;;) {
        const batch = await next(skipLocked);
        for (const b of batch) {
          if (covered >= want) break;
          taken.push(b);
          covered += toMilli(b.quantity) - toMilli(b.reserved);
        }
        if (covered >= want || batch.length < BATCH) break;
      }
      if (covered >= want) break;
    }
    return taken;
  }

  /** Every claim an order line has, oldest stock first, locked. */
  async heldForLineWithClient(client: PoolClient, orderLineId: string): Promise<HeldRow[]> {
    const r = await client.query<BalanceDbRow & { allocation_id: string; allocation_reserved: string; allocation_delivered: string }>(
      `SELECT a.id AS allocation_id, a.reserved_quantity::text AS allocation_reserved, a.delivered_quantity::text AS allocation_delivered,
              ${BALANCE_COLUMNS}
       FROM commerce.lot_allocation a JOIN stock.lot_balance b ON b.id = a.balance_id ${BALANCE_JOINS}
       WHERE a.order_line_id = $1
       ${FIFO}
       FOR UPDATE OF b, a`,
      [orderLineId],
    );
    return r.rows.map((x) => ({
      ...toBalance(x),
      allocationId: x.allocation_id,
      allocationReserved: x.allocation_reserved,
      allocationDelivered: x.allocation_delivered,
    }));
  }

  /** Everything on a vehicle, oldest first, locked. */
  async onVehicleWithClient(client: PoolClient, vehicleId: string): Promise<BalanceRow[]> {
    const r = await client.query<BalanceDbRow>(
      `SELECT ${BALANCE_COLUMNS} FROM stock.lot_balance b ${BALANCE_JOINS}
       WHERE loc.vehicle_id = $1 AND b.quantity > 0
       ${FIFO}
       FOR UPDATE OF b`,
      [vehicleId],
    );
    return r.rows.map(toBalance);
  }

  /** A lot's kilos in the store, oldest place first, locked. */
  async inStoreForLotWithClient(client: PoolClient, lotId: string): Promise<BalanceRow[]> {
    const r = await client.query<BalanceDbRow>(
      `SELECT ${BALANCE_COLUMNS} FROM stock.lot_balance b ${BALANCE_JOINS}
       WHERE b.lot_id = $1 AND loc.id IS NULL AND b.quantity > 0
       ${FIFO}
       FOR UPDATE OF b`,
      [lotId],
    );
    return r.rows.map(toBalance);
  }

  /** Claims on a balance with kilos still reserved, oldest claim first, locked. */
  async reservationsOnWithClient(client: PoolClient, balanceId: string): Promise<{ id: string; reserved: string }[]> {
    const r = await client.query<{ id: string; reserved: string }>(
      `SELECT id, reserved_quantity::text AS reserved FROM commerce.lot_allocation
       WHERE balance_id = $1 AND reserved_quantity > 0 ORDER BY created_at, id FOR UPDATE`,
      [balanceId],
    );
    return r.rows;
  }

  /** Holds `quantity` free kilos of a balance for an order line. False if they're no longer free. */
  async reserveWithClient(client: PoolClient, tenantId: string, b: BalanceRow, orderLineId: string, quantity: string): Promise<boolean> {
    const held = await client.query(
      `UPDATE stock.lot_balance SET reserved_quantity = reserved_quantity + $2, updated_at = now()
       WHERE id = $1 AND quantity - reserved_quantity >= $2`,
      [b.id, quantity],
    );
    if (held.rowCount !== 1) return false;
    await client.query(
      `INSERT INTO commerce.lot_allocation AS a (tenant_id, balance_id, lot_id, order_line_id, reserved_quantity)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (balance_id, order_line_id)
       DO UPDATE SET reserved_quantity = a.reserved_quantity + EXCLUDED.reserved_quantity, updated_at = now()`,
      [tenantId, b.id, b.lotId, orderLineId, quantity],
    );
    return true;
  }

  /** Lets go of `quantity` kilos a claim was holding; a claim left with nothing is removed. */
  async releaseWithClient(client: PoolClient, allocationId: string, balanceId: string, quantity: string): Promise<void> {
    await client.query(
      'UPDATE stock.lot_balance SET reserved_quantity = reserved_quantity - $2, updated_at = now() WHERE id = $1',
      [balanceId, quantity],
    );
    await this.shrinkClaimWithClient(client, allocationId, quantity);
  }

  private async shrinkClaimWithClient(client: PoolClient, allocationId: string, quantity: string): Promise<void> {
    await client.query(
      `WITH gone AS (
         DELETE FROM commerce.lot_allocation WHERE id = $1 AND reserved_quantity = $2 AND delivered_quantity = 0 RETURNING id
       )
       UPDATE commerce.lot_allocation SET reserved_quantity = reserved_quantity - $2, updated_at = now()
       WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM gone)`,
      [allocationId, quantity],
    );
  }

  /**
   * Takes kilos out of stock — `fromReserved` of them out of what the
   * balance held for the order line. A sale (`orderLineId`, or `sold` for a
   * spot sale) that empties the lot marks it delivered; a write-off leaves
   * its status alone. False if the balance no longer holds that much.
   */
  async takeWithClient(
    client: PoolClient,
    tenantId: string,
    b: { id: string; lotId: string },
    take: { quantity: string; fromReserved: string; orderLineId: string | null; sold: boolean },
  ): Promise<boolean> {
    const out = await client.query(
      `UPDATE stock.lot_balance SET quantity = quantity - $2, reserved_quantity = reserved_quantity - $3, updated_at = now()
       WHERE id = $1 AND quantity >= $2 AND reserved_quantity >= $3 AND quantity - $2 >= reserved_quantity - $3`,
      [b.id, take.quantity, take.fromReserved],
    );
    if (out.rowCount !== 1) return false;
    await client.query(
      `UPDATE commerce.lot SET current_quantity = current_quantity - $2,
              status = CASE WHEN $3 AND current_quantity - $2 <= 0 THEN 'delivered' ELSE status END,
              version = version + 1, updated_at = now()
       WHERE id = $1`,
      [b.lotId, take.quantity, take.sold],
    );
    if (take.orderLineId) {
      await client.query(
        `INSERT INTO commerce.lot_allocation AS a (tenant_id, balance_id, lot_id, order_line_id, delivered_quantity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (balance_id, order_line_id)
         DO UPDATE SET delivered_quantity = a.delivered_quantity + EXCLUDED.delivered_quantity,
                       reserved_quantity = a.reserved_quantity - $6, updated_at = now()`,
        [tenantId, b.id, b.lotId, take.orderLineId, take.quantity, take.fromReserved],
      );
    }
    return true;
  }

  /**
   * Moves `quantity` kilos of a balance to another place (null: the store).
   * All of it moves the balance itself, with every claim on it; part of it
   * splits off a new balance, taking `claim`'s reserved kilos along.
   * Returns the balance now at the destination.
   */
  async moveWithClient(
    client: PoolClient,
    tenantId: string,
    b: BalanceRow,
    quantity: string,
    toLocationId: string | null,
    claim: { allocationId: string; orderLineId: string; reserved: string } | null,
  ): Promise<string> {
    if (toMilli(quantity) === toMilli(b.quantity)) {
      await client.query('UPDATE stock.lot_balance SET location_id = $2, updated_at = now() WHERE id = $1', [b.id, toLocationId]);
      return b.id;
    }
    const reserved = claim?.reserved ?? '0';
    const r = await client.query<{ id: string }>(
      `INSERT INTO stock.lot_balance (tenant_id, lot_id, product_id, location_id, quantity, reserved_quantity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, b.lotId, b.productId, toLocationId, quantity, reserved],
    );
    await client.query(
      `UPDATE stock.lot_balance SET quantity = quantity - $2, reserved_quantity = reserved_quantity - $3, updated_at = now() WHERE id = $1`,
      [b.id, quantity, reserved],
    );
    if (claim && toMilli(reserved) > 0n) {
      await this.shrinkClaimWithClient(client, claim.allocationId, reserved);
      await client.query(
        `INSERT INTO commerce.lot_allocation AS a (tenant_id, balance_id, lot_id, order_line_id, reserved_quantity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (balance_id, order_line_id)
         DO UPDATE SET reserved_quantity = a.reserved_quantity + EXCLUDED.reserved_quantity, updated_at = now()`,
        [tenantId, r.rows[0].id, b.lotId, claim.orderLineId, reserved],
      );
    }
    return r.rows[0].id;
  }

  /** The vehicle's own stock location, made the first time stock goes onto it. */
  async vehicleLocationWithClient(client: PoolClient, tenantId: string, actorUserId: string, vehicleId: string): Promise<string> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('stock.vehicle-location:' || $1::text))`, [vehicleId]);
    const found = await client.query<{ id: string }>(
      `SELECT id FROM stock.location WHERE type = 'vehicle' AND vehicle_id = $1 AND status = 'active' ORDER BY created_at, id LIMIT 1`,
      [vehicleId],
    );
    if (found.rows[0]) return found.rows[0].id;
    const made = await client.query<{ id: string }>(
      `INSERT INTO stock.location (tenant_id, name, type, vehicle_id, created_by)
       SELECT $1, v.registration_number, 'vehicle', v.id, $3 FROM trading_partners.vehicle v WHERE v.id = $2
       RETURNING id`,
      [tenantId, vehicleId, actorUserId],
    );
    return made.rows[0].id;
  }

  async insertMovementWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    m: {
      lotId: string;
      productId: string;
      type: StockMovementType;
      quantity: string;
      reason?: string | null;
      fromLocationId?: string | null;
      toLocationId?: string | null;
      tripId?: string | null;
    },
  ): Promise<{ id: string; createdAt: Date }> {
    const r = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO stock.inventory_movement
         (tenant_id, lot_id, product_id, movement_type, quantity, reason, from_location_id, to_location_id, trip_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, created_at`,
      [tenantId, m.lotId, m.productId, m.type, m.quantity, m.reason ?? null, m.fromLocationId ?? null, m.toLocationId ?? null, m.tripId ?? null, actorUserId],
    );
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
  }

  /** What's on each vehicle (or one), product by product. */
  async vehicleStockWithClient(client: PoolClient, vehicleId: string | null): Promise<VehicleStockRow[]> {
    const r = await client.query<{
      vehicle_id: string;
      registration_number: string;
      product_id: string;
      product: string;
      uom: string;
      on_vehicle: string;
      reserved: string;
      value_at_cost: string;
    }>(
      `SELECT loc.vehicle_id, v.registration_number, b.product_id, pr.name AS product, pr.base_uom AS uom,
              SUM(b.quantity)::numeric(14,3)::text AS on_vehicle,
              SUM(b.reserved_quantity)::numeric(14,3)::text AS reserved,
              ROUND(SUM(b.quantity * COALESCE(l.unit_cost, 0)), 2)::text AS value_at_cost
       FROM stock.lot_balance b
       JOIN commerce.lot l ON l.id = b.lot_id
       JOIN stock.location loc ON loc.id = b.location_id AND loc.type = 'vehicle'
       JOIN trading_partners.vehicle v ON v.id = loc.vehicle_id
       JOIN trading_partners.product pr ON pr.id = b.product_id
       WHERE b.quantity > 0 AND ($1::uuid IS NULL OR loc.vehicle_id = $1)
       GROUP BY loc.vehicle_id, v.registration_number, b.product_id, pr.name, pr.base_uom
       ORDER BY v.registration_number, pr.name`,
      [vehicleId],
    );
    return r.rows.map((x) => ({
      vehicleId: x.vehicle_id,
      registrationNumber: x.registration_number,
      productId: x.product_id,
      product: x.product,
      uom: x.uom,
      onVehicle: x.on_vehicle,
      reserved: x.reserved,
      valueAtCost: x.value_at_cost,
    }));
  }

  /** Kilos reserved for each order line, wherever they are. */
  async reservedForLinesWithClient(client: PoolClient, orderLineIds: string[]): Promise<Map<string, string>> {
    const r = await client.query<{ order_line_id: string; reserved: string }>(
      `SELECT order_line_id, SUM(reserved_quantity)::numeric(14,3)::text AS reserved
       FROM commerce.lot_allocation WHERE order_line_id = ANY($1::uuid[]) GROUP BY order_line_id`,
      [orderLineIds],
    );
    return new Map(r.rows.map((x) => [x.order_line_id, x.reserved]));
  }
}

// Every row a lock batch returns stays locked until commit, so keep
// batches small: most order lines are covered by the first balance or two.
const BATCH = 5;

export const freeOf = (b: { quantity: string; reserved: string }): bigint => toMilli(b.quantity) - toMilli(b.reserved);
