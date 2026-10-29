import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CrewOption, FarmStopLine, FarmStopOutcome } from '../entities/farm-stop.entity';
import { FarmLine, FarmProduct } from '../farm-stop';

interface LineRow {
  trip_stop_id: string;
  product_id: string;
  product_name: string;
  uom: string;
  outcome: FarmStopLine['outcome'];
  accepted_quantity: string;
  rejected_quantity: string;
  measured_by: FarmStopLine['measuredBy'];
  sacks: number | null;
  kg_per_bag: string | null;
  reason: FarmStopLine['reason'];
  note: string | null;
}

/** The farmer stop's record (driver app D2): its lines product by product, and its packing crew. */
@Injectable()
export class FarmStopsRepository {
  async insertLinesWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    tripStopId: string,
    lines: (FarmLine & { lotId: string | null })[],
  ): Promise<void> {
    for (const l of lines) {
      await client.query(
        `INSERT INTO fulfilment.farm_stop_line
           (tenant_id, trip_stop_id, product_id, outcome, accepted_quantity, rejected_quantity, measured_by, sacks, kg_per_bag, reason, note, lot_id, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [tenantId, tripStopId, l.productId, l.outcome, l.acceptedQuantity, l.rejectedQuantity, l.measuredBy, l.sacks, l.kgPerBag, l.reason, l.note, l.lotId, actorUserId],
      );
    }
  }

  async setCrewWithClient(client: PoolClient, tripStopId: string, packerId: string | null, loaderId: string | null): Promise<void> {
    await client.query('UPDATE fulfilment.trip_stop SET packer_employee_id = $2, loader_employee_id = $3 WHERE id = $1', [tripStopId, packerId, loaderId]);
  }

  /** The completed farm stops of a trip, by stop id. */
  async outcomesForTripWithClient(client: PoolClient, tripId: string): Promise<Map<string, FarmStopOutcome>> {
    const lines = await client.query<LineRow>(
      `SELECT l.trip_stop_id, l.product_id, p.name AS product_name, p.base_uom AS uom, l.outcome,
              l.accepted_quantity::text, l.rejected_quantity::text, l.measured_by, l.sacks, l.kg_per_bag::text, l.reason, l.note
       FROM fulfilment.farm_stop_line l
       JOIN fulfilment.trip_stop s ON s.id = l.trip_stop_id
       JOIN trading_partners.product p ON p.id = l.product_id
       WHERE s.trip_id = $1
       ORDER BY p.name`,
      [tripId],
    );
    const crew = await client.query<{ id: string; packer_id: string | null; packer: string | null; loader_id: string | null; loader: string | null }>(
      `SELECT s.id, s.packer_employee_id AS packer_id, pk.name AS packer, s.loader_employee_id AS loader_id, ld.name AS loader
       FROM fulfilment.trip_stop s
       LEFT JOIN trading_partners.employee pk ON pk.id = s.packer_employee_id
       LEFT JOIN trading_partners.employee ld ON ld.id = s.loader_employee_id
       WHERE s.trip_id = $1 AND s.stop_type = 'pickup'`,
      [tripId],
    );
    const out = new Map<string, FarmStopOutcome>();
    for (const c of crew.rows) {
      const mine = lines.rows.filter((l) => l.trip_stop_id === c.id);
      if (mine.length === 0 && !c.packer_id && !c.loader_id) continue;
      const kg = mine
        .filter((l) => l.outcome === 'accepted' && (l.uom === 'kg' || l.uom === 'g'))
        .reduce((n, l) => n + (l.uom === 'kg' ? Number(l.accepted_quantity) * 1000 : Number(l.accepted_quantity)), 0);
      out.set(c.id, {
        packer: c.packer_id ? { employeeId: c.packer_id, name: c.packer ?? '' } : null,
        loader: c.loader_id ? { employeeId: c.loader_id, name: c.loader ?? '' } : null,
        lines: mine.map((l) => ({
          productId: l.product_id,
          productName: l.product_name,
          uom: l.uom,
          outcome: l.outcome,
          acceptedQuantity: l.accepted_quantity,
          rejectedQuantity: l.rejected_quantity,
          measuredBy: l.measured_by,
          sacks: l.sacks,
          kgPerBag: l.kg_per_bag,
          reason: l.reason,
          note: l.note,
        })),
        loadedKg: (Math.round(kg) / 1000).toFixed(3),
      });
    }
    return out;
  }

  /** The business's active workers, for the packer and loader: warehouse hands first. */
  async crewOptionsWithClient(client: PoolClient): Promise<CrewOption[]> {
    const r = await client.query<{ id: string; name: string; role_type: string }>(
      `SELECT id, name, role_type FROM trading_partners.employee
       WHERE status = 'active'
       ORDER BY CASE role_type WHEN 'warehouse' THEN 0 WHEN 'other' THEN 1 WHEN 'procurement' THEN 2 WHEN 'driver' THEN 3 ELSE 4 END, name`,
    );
    return r.rows.map((e) => ({ employeeId: e.id, name: e.name, roleType: e.role_type }));
  }

  /** Of [ids], the active workers, by id → name. */
  async activeWorkersWithClient(client: PoolClient, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const r = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM trading_partners.employee WHERE id = ANY($1::uuid[]) AND status = 'active'`,
      [ids],
    );
    return new Map(r.rows.map((e) => [e.id, e.name]));
  }

  async farmerNameWithClient(client: PoolClient, purchaseOrderId: string): Promise<string> {
    const r = await client.query<{ name: string }>(
      `SELECT f.name FROM commerce.purchase_order po JOIN trading_partners.farmer f ON f.id = po.farmer_id WHERE po.id = $1`,
      [purchaseOrderId],
    );
    return r.rows[0]?.name ?? 'the farm';
  }

  /** The products of a purchase order, with their names and units. */
  async poProductsWithClient(client: PoolClient, purchaseOrderId: string): Promise<FarmProduct[]> {
    const r = await client.query<{ product_id: string; name: string; uom: string }>(
      `SELECT DISTINCT l.product_id, p.name, p.base_uom AS uom
       FROM commerce.purchase_order_line l JOIN trading_partners.product p ON p.id = l.product_id
       WHERE l.purchase_order_id = $1
       ORDER BY p.name`,
      [purchaseOrderId],
    );
    return r.rows.map((p) => ({ productId: p.product_id, name: p.name, uom: p.uom }));
  }
}
