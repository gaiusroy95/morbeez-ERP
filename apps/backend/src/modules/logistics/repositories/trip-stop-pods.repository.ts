import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TripStopPodRecord } from '../entities/trip-stop-pod.entity';

interface TripStopPodRow {
  id: string;
  trip_stop_id: string;
  recipient_name: string;
  signature_data: string | null;
  captured_at: Date;
  captured_by: string;
}

function toRecord(row: TripStopPodRow): TripStopPodRecord {
  return {
    id: row.id,
    tripStopId: row.trip_stop_id,
    recipientName: row.recipient_name,
    signatureData: row.signature_data,
    capturedAt: row.captured_at,
    capturedBy: row.captured_by,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

@Injectable()
export class TripStopPodsRepository {
  async findByStopWithClient(client: PoolClient, tripStopId: string): Promise<TripStopPodRecord | null> {
    const result = await client.query<TripStopPodRow>(
      'SELECT * FROM fulfilment.trip_stop_pod WHERE trip_stop_id = $1',
      [tripStopId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    capturedBy: string,
    fields: { tripStopId: string; recipientName: string; signatureData: string | null },
  ): Promise<TripStopPodRecord> {
    try {
      const result = await client.query<TripStopPodRow>(
        `INSERT INTO fulfilment.trip_stop_pod (trip_stop_id, recipient_name, signature_data, captured_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [fields.tripStopId, fields.recipientName, fields.signatureData, capturedBy],
      );
      return toRecord(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This stop already has a proof of delivery on file');
      }
      throw err;
    }
  }
}
