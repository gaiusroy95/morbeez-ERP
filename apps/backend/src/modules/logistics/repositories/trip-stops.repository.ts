import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { StopItem, StopParty, StopStatus, StopType, TripStopRecord } from '../entities/trip-stop.entity';

interface TripStopRow {
  id: string;
  trip_id: string;
  sequence_number: number;
  stop_type: StopType;
  pickup_id: string | null;
  order_id: string | null;
  status: StopStatus;
  arrived_at: Date | null;
  completed_at: Date | null;
  notes: string | null;
  created_at: Date;
}

function toRecord(row: TripStopRow): TripStopRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    sequenceNumber: row.sequence_number,
    stopType: row.stop_type,
    pickupId: row.pickup_id,
    orderId: row.order_id,
    status: row.status,
    arrivedAt: row.arrived_at,
    completedAt: row.completed_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

@Injectable()
export class TripStopsRepository {
  async listByTripWithClient(client: PoolClient, tripId: string): Promise<TripStopRecord[]> {
    const result = await client.query<TripStopRow>(
      'SELECT * FROM fulfilment.trip_stop WHERE trip_id = $1 ORDER BY sequence_number',
      [tripId],
    );
    return result.rows.map(toRecord);
  }

  /** Each stop's party and items, for one trip — the order or purchase order behind it, never anything else. */
  async detailsForTripWithClient(
    client: PoolClient,
    tripId: string,
  ): Promise<Map<string, { party: StopParty | null; items: StopItem[] }>> {
    const parties = await client.query<{ stop_id: string; kind: 'customer' | 'farmer'; id: string; name: string; phone: string | null }>(
      `SELECT s.id AS stop_id, 'customer' AS kind, c.id, c.name, c.contact->>'phone' AS phone
       FROM fulfilment.trip_stop s JOIN commerce.customer_order o ON o.id = s.order_id JOIN trading_partners.customer c ON c.id = o.customer_id
       WHERE s.trip_id = $1
       UNION ALL
       SELECT s.id, 'farmer', f.id, f.name, f.contact->>'phone'
       FROM fulfilment.trip_stop s JOIN commerce.pickup p ON p.id = s.pickup_id
       JOIN commerce.purchase_order po ON po.id = p.purchase_order_id JOIN trading_partners.farmer f ON f.id = po.farmer_id
       WHERE s.trip_id = $1`,
      [tripId],
    );
    const items = await client.query<{ stop_id: string; product_name: string; quantity: string; uom: string }>(
      `SELECT s.id AS stop_id, pr.name AS product_name, ol.quantity::text AS quantity, pr.base_uom AS uom
       FROM fulfilment.trip_stop s JOIN commerce.customer_order_line ol ON ol.order_id = s.order_id
       JOIN trading_partners.product pr ON pr.id = ol.product_id
       WHERE s.trip_id = $1
       UNION ALL
       SELECT s.id, pr.name, pl.expected_quantity::text, pr.base_uom
       FROM fulfilment.trip_stop s JOIN commerce.pickup p ON p.id = s.pickup_id
       JOIN commerce.purchase_order_line pl ON pl.purchase_order_id = p.purchase_order_id
       JOIN trading_partners.product pr ON pr.id = pl.product_id
       WHERE s.trip_id = $1
       ORDER BY 2`,
      [tripId],
    );
    const out = new Map<string, { party: StopParty | null; items: StopItem[] }>();
    const entry = (id: string) => out.get(id) ?? out.set(id, { party: null, items: [] }).get(id)!;
    for (const r of parties.rows) entry(r.stop_id).party = { kind: r.kind, id: r.id, name: r.name, phone: r.phone };
    for (const r of items.rows) entry(r.stop_id).items.push({ productName: r.product_name, quantity: r.quantity, uom: r.uom });
    return out;
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<TripStopRecord | null> {
    const result = await client.query<TripStopRow>('SELECT * FROM fulfilment.trip_stop WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /**
   * Puts a trip's stops in the given order, 1..n. Two passes, because the
   * (trip_id, sequence_number) unique constraint checks every row as it's
   * written: first out of the way, then into place.
   */
  async resequenceWithClient(client: PoolClient, tripId: string, stopIds: string[]): Promise<void> {
    await client.query('UPDATE fulfilment.trip_stop SET sequence_number = sequence_number + 100000 WHERE trip_id = $1', [tripId]);
    await client.query(
      `UPDATE fulfilment.trip_stop s SET sequence_number = o.n
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, n) WHERE s.id = o.id AND s.trip_id = $1`,
      [tripId, stopIds],
    );
  }

  async nextSequenceNumberWithClient(client: PoolClient, tripId: string): Promise<number> {
    const result = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next FROM fulfilment.trip_stop WHERE trip_id = $1',
      [tripId],
    );
    return result.rows[0].next;
  }

  async createWithClient(
    client: PoolClient,
    fields: {
      tripId: string;
      sequenceNumber: number;
      stopType: StopType;
      pickupId: string | null;
      orderId: string | null;
      notes: string | null;
    },
  ): Promise<TripStopRecord> {
    try {
      const result = await client.query<TripStopRow>(
        `INSERT INTO fulfilment.trip_stop (trip_id, sequence_number, stop_type, pickup_id, order_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [fields.tripId, fields.sequenceNumber, fields.stopType, fields.pickupId, fields.orderId, fields.notes],
      );
      return toRecord(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`This trip already has a stop at sequence ${fields.sequenceNumber}`);
      }
      throw err;
    }
  }

  async completeWithClient(client: PoolClient, id: string): Promise<TripStopRecord | null> {
    const result = await client.query<TripStopRow>(
      `UPDATE fulfilment.trip_stop SET status = 'completed', completed_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async skipWithClient(client: PoolClient, id: string): Promise<TripStopRecord | null> {
    const result = await client.query<TripStopRow>(
      `UPDATE fulfilment.trip_stop SET status = 'skipped', completed_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async countPendingWithClient(client: PoolClient, tripId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*) FROM fulfilment.trip_stop WHERE trip_id = $1 AND status = 'pending'`,
      [tripId],
    );
    return Number(result.rows[0].count);
  }

  async countWithClient(client: PoolClient, tripId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      'SELECT count(*) FROM fulfilment.trip_stop WHERE trip_id = $1',
      [tripId],
    );
    return Number(result.rows[0].count);
  }
}
