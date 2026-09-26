import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PhotoType, TripStopPhotoRecord } from '../entities/trip-stop-photo.entity';

interface TripStopPhotoRow {
  id: string;
  trip_stop_id: string;
  photo_type: PhotoType;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  taken_at: Date;
  created_by: string;
}

function toRecord(row: TripStopPhotoRow): TripStopPhotoRecord {
  return {
    id: row.id,
    tripStopId: row.trip_stop_id,
    photoType: row.photo_type,
    storageKey: row.storage_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    takenAt: row.taken_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class TripStopPhotosRepository {
  async listByStopWithClient(client: PoolClient, tripStopId: string): Promise<TripStopPhotoRecord[]> {
    const result = await client.query<TripStopPhotoRow>(
      'SELECT * FROM fulfilment.trip_stop_photo WHERE trip_stop_id = $1 ORDER BY taken_at',
      [tripStopId],
    );
    return result.rows.map(toRecord);
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<TripStopPhotoRecord | null> {
    const result = await client.query<TripStopPhotoRow>(
      'SELECT * FROM fulfilment.trip_stop_photo WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async countByStopAndTypeWithClient(client: PoolClient, tripStopId: string, photoType: PhotoType): Promise<number> {
    const result = await client.query<{ count: string }>(
      'SELECT count(*) FROM fulfilment.trip_stop_photo WHERE trip_stop_id = $1 AND photo_type = $2',
      [tripStopId, photoType],
    );
    return Number(result.rows[0].count);
  }

  async createWithClient(
    client: PoolClient,
    createdBy: string,
    fields: {
      tripStopId: string;
      photoType: PhotoType;
      storageKey: string;
      contentType: string;
      sizeBytes: number;
    },
  ): Promise<TripStopPhotoRecord> {
    const result = await client.query<TripStopPhotoRow>(
      `INSERT INTO fulfilment.trip_stop_photo (trip_stop_id, photo_type, storage_key, content_type, size_bytes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [fields.tripStopId, fields.photoType, fields.storageKey, fields.contentType, fields.sizeBytes, createdBy],
    );
    return toRecord(result.rows[0]);
  }
}
