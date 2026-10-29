import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DeliveryOutcome, DeliveryShortfall } from '../entities/delivery-stop.entity';
import { DeliveryLine, Shortfall } from '../delivery-stop';

/** A delivery stop's record (driver app D3): its checklist, what was delivered short, its crates. */
@Injectable()
export class DeliveryStopsRepository {
  /** The order's lines with their products, and its customer's QR token. */
  async factsWithClient(client: PoolClient, orderId: string): Promise<{ qrToken: string; customerName: string; lines: DeliveryLine[] }> {
    const customer = await client.query<{ qr_token: string; name: string }>(
      `SELECT c.qr_token, c.name FROM commerce.customer_order o JOIN trading_partners.customer c ON c.id = o.customer_id WHERE o.id = $1`,
      [orderId],
    );
    const lines = await client.query<{ id: string; name: string; quantity: string }>(
      `SELECT ol.id, p.name, ol.quantity::text AS quantity
       FROM commerce.customer_order_line ol JOIN trading_partners.product p ON p.id = ol.product_id
       WHERE ol.order_id = $1`,
      [orderId],
    );
    return {
      qrToken: customer.rows[0]?.qr_token ?? '',
      customerName: customer.rows[0]?.name ?? '',
      lines: lines.rows.map((l) => ({ id: l.id, productName: l.name, quantity: l.quantity })),
    };
  }

  async insertShortfallsWithClient(client: PoolClient, tenantId: string, actorUserId: string, tripStopId: string, shortfalls: Shortfall[]): Promise<void> {
    for (const s of shortfalls) {
      await client.query(
        `INSERT INTO fulfilment.delivery_shortfall (tenant_id, trip_stop_id, order_line_id, ordered_quantity, delivered_quantity, reason, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, tripStopId, s.orderLineId, s.ordered, s.delivered, s.reason, s.note, actorUserId],
      );
    }
  }

  /** The completed deliveries of a trip, by stop id. */
  async outcomesForTripWithClient(client: PoolClient, tripId: string): Promise<Map<string, DeliveryOutcome>> {
    const pods = await client.query<{ stop_id: string; recipient_name: string; qr_status: DeliveryOutcome['qrStatus']; qr_note: string | null; all_unloaded: boolean | null }>(
      `SELECT p.trip_stop_id AS stop_id, p.recipient_name, p.qr_status, p.qr_note, p.all_unloaded
       FROM fulfilment.trip_stop_pod p JOIN fulfilment.trip_stop s ON s.id = p.trip_stop_id
       WHERE s.trip_id = $1`,
      [tripId],
    );
    const shorts = await client.query<{ stop_id: string; order_line_id: string; name: string; uom: string; ordered: string; delivered: string; reason: DeliveryShortfall['reason']; note: string | null }>(
      `SELECT d.trip_stop_id AS stop_id, d.order_line_id, p.name, p.base_uom AS uom, d.ordered_quantity::text AS ordered,
              d.delivered_quantity::text AS delivered, d.reason, d.note
       FROM fulfilment.delivery_shortfall d
       JOIN fulfilment.trip_stop s ON s.id = d.trip_stop_id
       JOIN commerce.customer_order_line ol ON ol.id = d.order_line_id
       JOIN trading_partners.product p ON p.id = ol.product_id
       WHERE s.trip_id = $1
       ORDER BY p.name`,
      [tripId],
    );
    const crates = await client.query<{ stop_id: string; dropped: number; collected: number }>(
      `SELECT m.trip_stop_id AS stop_id,
              COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'delivered'), 0)::int AS dropped,
              COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'collected'), 0)::int AS collected
       FROM crates.movement m
       WHERE m.trip_id = $1 AND m.trip_stop_id IS NOT NULL AND m.reverses_movement_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM crates.movement r WHERE r.reverses_movement_id = m.id)
       GROUP BY m.trip_stop_id`,
      [tripId],
    );
    const out = new Map<string, DeliveryOutcome>();
    for (const p of pods.rows) {
      const c = crates.rows.find((r) => r.stop_id === p.stop_id);
      out.set(p.stop_id, {
        recipientName: p.recipient_name,
        qrStatus: p.qr_status,
        qrNote: p.qr_note,
        allUnloaded: p.all_unloaded,
        shortfalls: shorts.rows
          .filter((s) => s.stop_id === p.stop_id)
          .map((s) => ({ orderLineId: s.order_line_id, productName: s.name, uom: s.uom, ordered: s.ordered, delivered: s.delivered, reason: s.reason, note: s.note })),
        crates: { dropped: c?.dropped ?? 0, collected: c?.collected ?? 0 },
      });
    }
    return out;
  }
}
