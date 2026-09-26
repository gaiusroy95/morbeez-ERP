import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { StopStatus, StopType, TripStopRecord } from '../entities/trip-stop.entity';

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

  async findByIdWithClient(client: PoolClient, id: string): Promise<TripStopRecord | null> {
    const result = await client.query<TripStopRow>('SELECT * FROM fulfilment.trip_stop WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
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
