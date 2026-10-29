import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { costOfDraws, fromMilli, minMilli, toMilli } from '../../common/quantity';
import { multiplyToMoney, sumMoney } from '../../common/money';
import { BalanceRow, freeOf, LotStockRepository, VehicleStockRow } from './repositories/lot-stock.repository';

// Every stock change is audited against what it was done for: the order
// line it was reserved, delivered or loaded for, or the trip it came back from.
const STOCK_ENTITY = 'lot_stock';

export interface Draw {
  lotId: string;
  balanceId: string;
  quantity: string;
  unitCost: string | null;
}

export interface ReturnedProduct {
  productId: string;
  onVehicle: string;
  counted: string | null;
  writtenOff: string;
  writtenOffValue: string;
  returned: string;
}

/**
 * Stock by the kilo (driver app D0, docs/redesign/driver-app-v1-plan.md).
 * Procurement owns lots, so it owns where their kilos are: Orders reserves
 * and delivers through this, Logistics loads vehicles and brings what's
 * left back, Spot sales sell the free kilos on a vehicle.
 */
@Injectable()
export class LotStockService {
  constructor(
    private readonly db: DatabaseService,
    private readonly stock: LotStockRepository,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Holds the store's free kilos for an order line, oldest first, inside
   * Orders' confirmation. What the store doesn't have is "to come" — from
   * the day's procurement onto the trip's vehicle — and doesn't stop the
   * order: the trip's quantity check shows any shortage.
   */
  async reserveForOrderLineWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    line: { orderLineId: string; productId: string; quantity: string },
  ): Promise<{ reserved: string; toCome: string }> {
    let left = toMilli(line.quantity);
    const draws: Draw[] = [];
    for (const b of await this.stock.lockFreeWithClient(client, line.productId, line.quantity, null)) {
      if (left <= 0n) break;
      const take = minMilli(freeOf(b), left);
      if (take <= 0n) continue;
      if (!(await this.stock.reserveWithClient(client, tenantId, b, line.orderLineId, fromMilli(take)))) continue;
      draws.push({ lotId: b.lotId, balanceId: b.id, quantity: fromMilli(take), unitCost: b.unitCost });
      left -= take;
    }
    const reserved = fromMilli(toMilli(line.quantity) - left);
    if (draws.length > 0) {
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: STOCK_ENTITY,
        entityId: line.orderLineId,
        after: { reserved, toCome: fromMilli(left), draws } as unknown as Record<string, unknown>,
      });
    }
    return { reserved, toCome: fromMilli(left) };
  }

  releaseForOrderLine(tenantId: string, actorUserId: string, orderLineId: string): Promise<void> {
    return this.db.withTenant(tenantId, (client) => this.releaseForOrderLineWithClient(client, tenantId, actorUserId, orderLineId));
  }

  /** Lets go of every kilo still held for the order line (it was cancelled, or delivered short). */
  async releaseForOrderLineWithClient(client: PoolClient, tenantId: string, actorUserId: string, orderLineId: string): Promise<void> {
    const released: Draw[] = [];
    for (const h of await this.stock.heldForLineWithClient(client, orderLineId)) {
      if (toMilli(h.allocationReserved) <= 0n) continue;
      await this.stock.releaseWithClient(client, h.allocationId, h.id, h.allocationReserved);
      released.push({ lotId: h.lotId, balanceId: h.id, quantity: h.allocationReserved, unitCost: h.unitCost });
    }
    if (released.length > 0) {
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: STOCK_ENTITY,
        entityId: orderLineId,
        after: { released } as unknown as Record<string, unknown>,
      });
    }
  }

  /**
   * The delivered quantity of an order line leaves stock, inside Orders'
   * delivery transaction: the kilos reserved for it first (wherever they
   * are), then free kilos on the trip's vehicle — or, for a delivery made
   * without a trip, in the store — oldest first. Anything still reserved
   * for the line is let go. Returns the line's cost of goods, exactly
   * those kilos at their lots' cost (Accounting Engine LOT.1), or null when
   * none of them carries a cost.
   */
  async deliverForOrderLineWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    line: { orderLineId: string; productId: string; label: string; quantity: string; vehicleId: string | null; tripId: string | null },
  ): Promise<string | null> {
    let left = toMilli(line.quantity);
    const draws: (Draw & { locationId: string | null })[] = [];

    for (const h of await this.stock.heldForLineWithClient(client, line.orderLineId)) {
      const held = toMilli(h.allocationReserved);
      if (held <= 0n) continue;
      const take = minMilli(held, left);
      if (take > 0n) {
        await this.take(client, tenantId, h, fromMilli(take), fromMilli(take), line.orderLineId);
        draws.push({ lotId: h.lotId, balanceId: h.id, quantity: fromMilli(take), unitCost: h.unitCost, locationId: h.locationId });
        left -= take;
      }
      if (held > take) await this.stock.releaseWithClient(client, h.allocationId, h.id, fromMilli(held - take));
    }

    if (left > 0n) {
      for (const b of await this.stock.lockFreeWithClient(client, line.productId, fromMilli(left), line.vehicleId)) {
        if (left <= 0n) break;
        const take = minMilli(freeOf(b), left);
        if (take <= 0n) continue;
        await this.take(client, tenantId, b, fromMilli(take), '0', line.orderLineId);
        draws.push({ lotId: b.lotId, balanceId: b.id, quantity: fromMilli(take), unitCost: b.unitCost, locationId: b.locationId });
        left -= take;
      }
    }
    if (left > 0n) {
      throw new ConflictException(
        `Not enough ${line.label} ${line.vehicleId ? 'on the vehicle' : 'in stock'} to deliver ${Number(line.quantity)}: ` +
          `${Number(fromMilli(left))} short — record the farm pickup or the stock first`,
      );
    }

    for (const d of draws) {
      await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
        lotId: d.lotId,
        productId: line.productId,
        type: 'delivered',
        quantity: d.quantity,
        fromLocationId: d.locationId,
        tripId: line.tripId,
      });
    }
    const cost = costOfDraws(draws);
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'update',
      entityType: STOCK_ENTITY,
      entityId: line.orderLineId,
      after: { delivered: line.quantity, cost, draws } as unknown as Record<string, unknown>,
    });
    return cost;
  }

  /**
   * Starting a trip: the kilos reserved for its deliveries that are still
   * in the store go onto the vehicle (its stock location, made the first
   * time). Part of a lot can go; the rest stays behind.
   */
  async loadOrderLinesWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    trip: { id: string; vehicleId: string },
    orderLineIds: string[],
  ): Promise<void> {
    let to: string | null = null;
    for (const orderLineId of [...orderLineIds].sort()) {
      const loaded: Draw[] = [];
      for (const h of await this.stock.heldForLineWithClient(client, orderLineId)) {
        if (h.vehicleId !== null || toMilli(h.allocationReserved) <= 0n) continue;
        to ??= await this.stock.vehicleLocationWithClient(client, tenantId, actorUserId, trip.vehicleId);
        await this.stock.moveWithClient(client, tenantId, h, h.allocationReserved, to, {
          allocationId: h.allocationId,
          orderLineId,
          reserved: h.allocationReserved,
        });
        await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
          lotId: h.lotId,
          productId: h.productId,
          type: 'loaded',
          quantity: h.allocationReserved,
          fromLocationId: h.locationId,
          toLocationId: to,
          tripId: trip.id,
        });
        loaded.push({ lotId: h.lotId, balanceId: h.id, quantity: h.allocationReserved, unitCost: h.unitCost });
      }
      if (loaded.length > 0) {
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'update',
          entityType: STOCK_ENTITY,
          entityId: orderLineId,
          after: { loaded, tripId: trip.id, vehicleId: trip.vehicleId } as unknown as Record<string, unknown>,
        });
      }
    }
  }

  /**
   * Starting a trip on a vehicle that still has stock aboard (an earlier
   * trip not closed yet): the stock goes on with this trip, recorded as
   * loaded onto it where it stands. The earlier trip's closing then leaves
   * it alone; this trip's closing counts it and brings it back.
   */
  async carryOverWithClient(client: PoolClient, tenantId: string, actorUserId: string, trip: { id: string; vehicleId: string }): Promise<string> {
    const aboard = await this.stock.onVehicleWithClient(client, trip.vehicleId);
    for (const b of aboard) {
      await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
        lotId: b.lotId,
        productId: b.productId,
        type: 'loaded',
        quantity: b.quantity,
        reason: 'Already on the vehicle',
        fromLocationId: b.locationId,
        toLocationId: b.locationId,
        tripId: trip.id,
      });
    }
    return fromMilli(aboard.reduce((n, b) => n + toMilli(b.quantity), 0n));
  }

  vehicleLocationWithClient(client: PoolClient, tenantId: string, actorUserId: string, vehicleId: string): Promise<string> {
    return this.stock.vehicleLocationWithClient(client, tenantId, actorUserId, vehicleId);
  }

  /**
   * Closing a trip: what's missing from the count is written off at cost
   * (oldest stock first, free kilos before reserved ones, with the owner's
   * reason), and everything left on the vehicle goes back to the store —
   * with its reservations, for deliveries that didn't happen. No count
   * means the vehicle holds what the books say.
   */
  async returnFromVehicleWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    trip: { id: string; vehicleId: string },
    counted: Map<string, string> | null,
    reason: string | null,
  ): Promise<ReturnedProduct[]> {
    const balances = await this.stock.onVehicleWithClient(client, trip.vehicleId);
    const byProduct = new Map<string, BalanceRow[]>();
    for (const b of balances) byProduct.set(b.productId, [...(byProduct.get(b.productId) ?? []), b]);

    const out: ReturnedProduct[] = [];
    for (const [productId, mine] of [...byProduct].sort(([a], [b]) => a.localeCompare(b))) {
      const on = mine.reduce((n, b) => n + toMilli(b.quantity), 0n);
      const count = counted ? toMilli(counted.get(productId) ?? '0') : on;
      let missing = on > count ? on - count : 0n;
      const writeOffs: Draw[] = [];
      // Free kilos go first; only then are reservations let go to cover the rest.
      for (const pass of ['free', 'reserved'] as const) {
        for (const b of mine) {
          if (missing <= 0n) break;
          const take = minMilli(pass === 'free' ? freeOf(b) : toMilli(b.quantity), missing);
          if (take <= 0n) continue;
          if (pass === 'reserved') {
            let release = take;
            for (const a of await this.stock.reservationsOnWithClient(client, b.id)) {
              if (release <= 0n) break;
              const part = minMilli(toMilli(a.reserved), release);
              await this.stock.releaseWithClient(client, a.id, b.id, fromMilli(part));
              release -= part;
            }
            b.reserved = fromMilli(toMilli(b.reserved) - take);
          }
          await this.take(client, tenantId, b, fromMilli(take), '0', null, false);
          b.quantity = fromMilli(toMilli(b.quantity) - take);
          writeOffs.push({ lotId: b.lotId, balanceId: b.id, quantity: fromMilli(take), unitCost: b.unitCost });
          missing -= take;
        }
      }
      const values: string[] = [];
      for (const w of writeOffs) {
        const movement = await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
          lotId: w.lotId,
          productId,
          type: 'shrinkage',
          quantity: w.quantity,
          reason: reason ?? 'Missing from the vehicle at trip closing',
          fromLocationId: mine.find((b) => b.id === w.balanceId)?.locationId ?? null,
          tripId: trip.id,
        });
        if (w.unitCost !== null) {
          const value = multiplyToMoney(w.quantity, w.unitCost);
          values.push(value);
          await this.ledger.postInventoryWriteOffWithClient(client, tenantId, actorUserId, {
            movementId: movement.id,
            lotId: w.lotId,
            kind: 'shrinkage',
            value,
            reason: reason ?? 'Missing from the vehicle at trip closing',
            occurredAt: movement.createdAt,
          });
        }
      }

      let returned = 0n;
      for (const b of mine) {
        if (toMilli(b.quantity) <= 0n) continue;
        await this.stock.moveWithClient(client, tenantId, b, b.quantity, null, null);
        await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
          lotId: b.lotId,
          productId,
          type: 'returned',
          quantity: b.quantity,
          fromLocationId: b.locationId,
          tripId: trip.id,
        });
        returned += toMilli(b.quantity);
      }
      out.push({
        productId,
        onVehicle: fromMilli(on),
        counted: counted ? fromMilli(count) : null,
        writtenOff: fromMilli(on - returned),
        writtenOffValue: sumMoney(values),
        returned: fromMilli(returned),
      });
    }

    if (out.length > 0) {
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: STOCK_ENTITY,
        entityId: trip.id,
        after: { returnedFromVehicle: trip.vehicleId, products: out } as unknown as Record<string, unknown>,
      });
    }
    return out;
  }

  vehicleStock(tenantId: string, vehicleId: string | null): Promise<VehicleStockRow[]> {
    return this.db.withTenant(tenantId, (client) => this.stock.vehicleStockWithClient(client, vehicleId));
  }

  vehicleStockWithClient(client: PoolClient, vehicleId: string | null): Promise<VehicleStockRow[]> {
    return this.stock.vehicleStockWithClient(client, vehicleId);
  }

  reservedForLinesWithClient(client: PoolClient, orderLineIds: string[]): Promise<Map<string, string>> {
    return this.stock.reservedForLinesWithClient(client, orderLineIds);
  }

  /** The free kilos on a vehicle — what a spot sale can sell — oldest first. */
  async freeOnVehicleWithClient(client: PoolClient, vehicleId: string): Promise<BalanceRow[]> {
    return (await this.stock.onVehicleWithClient(client, vehicleId)).filter((b) => freeOf(b) > 0n);
  }

  /** A spot sale takes free kilos off a vehicle. False if they're no longer there. */
  async takeForSaleWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    draw: { balanceId: string; lotId: string; productId: string; quantity: string; locationId: string | null; reason: string; tripId: string },
  ): Promise<boolean> {
    if (!(await this.stock.takeWithClient(client, tenantId, { id: draw.balanceId, lotId: draw.lotId }, { quantity: draw.quantity, fromReserved: '0', orderLineId: null, sold: true }))) {
      return false;
    }
    await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
      lotId: draw.lotId,
      productId: draw.productId,
      type: 'spot_sold',
      quantity: draw.quantity,
      reason: draw.reason,
      fromLocationId: draw.locationId,
      tripId: draw.tripId,
    });
    return true;
  }

  private async take(
    client: PoolClient,
    tenantId: string,
    b: { id: string; lotId: string },
    quantity: string,
    fromReserved: string,
    orderLineId: string | null,
    sold = true,
  ): Promise<void> {
    if (!(await this.stock.takeWithClient(client, tenantId, b, { quantity, fromReserved, orderLineId, sold }))) {
      throw new ConflictException('The stock changed while it was being taken — try again');
    }
  }
}
