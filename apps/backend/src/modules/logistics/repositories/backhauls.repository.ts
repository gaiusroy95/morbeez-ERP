import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  BackhaulPaymentMethod,
  BackhaulPhotoRecord,
  BackhaulPhotoType,
  BackhaulRecord,
  BackhaulStatus,
  BackhaulStep,
} from '../entities/backhaul.entity';

interface BackhaulRow {
  id: string;
  trip_id: string;
  pickup_place: string;
  drop_place: string;
  rent: string;
  hirer_name: string | null;
  notes: string | null;
  offered_by: 'owner' | 'driver';
  status: BackhaulStatus;
  skip_reason: string | null;
  accepted_at: Date | null;
  pickup_reached_at: Date | null;
  loaded_at: Date | null;
  drop_reached_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  payment_method: BackhaulPaymentMethod | null;
  amount_received: string | null;
  payment_reference: string | null;
  payment_note: string | null;
  paid_at: Date | null;
  created_at: Date;
  version: number;
  load_photos: number;
  drop_photos: number;
  payment_photos: number;
}

function toRecord(r: BackhaulRow): BackhaulRecord {
  return {
    id: r.id,
    tripId: r.trip_id,
    pickupPlace: r.pickup_place,
    dropPlace: r.drop_place,
    rent: r.rent,
    hirerName: r.hirer_name,
    notes: r.notes,
    offeredBy: r.offered_by,
    status: r.status,
    skipReason: r.skip_reason,
    acceptedAt: r.accepted_at,
    pickupReachedAt: r.pickup_reached_at,
    loadedAt: r.loaded_at,
    dropReachedAt: r.drop_reached_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    payment:
      r.paid_at && r.payment_method && r.amount_received
        ? { method: r.payment_method, amount: r.amount_received, reference: r.payment_reference, note: r.payment_note, paidAt: r.paid_at }
        : null,
    photos: { load: r.load_photos, drop: r.drop_photos, payment: r.payment_photos },
    createdAt: r.created_at,
    version: r.version,
  };
}

// "drop" is an SQL keyword: the counts are named for what they count.
const SELECT = `
  SELECT b.*, p.load_photos, p.drop_photos, p.payment_photos
  FROM fulfilment.backhaul b
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ph.photo_type = 'load')::int AS load_photos,
           count(*) FILTER (WHERE ph.photo_type = 'drop')::int AS drop_photos,
           count(*) FILTER (WHERE ph.photo_type = 'payment')::int AS payment_photos
    FROM fulfilment.backhaul_photo ph WHERE ph.backhaul_id = b.id
  ) p`;

const STEP_COLUMN: Record<BackhaulStep, string> = {
  pickup_reached: 'pickup_reached_at',
  loaded: 'loaded_at',
  drop_reached: 'drop_reached_at',
  completed: 'completed_at',
};

/** fulfilment.backhaul and its photos (driver app D5). */
@Injectable()
export class BackhaulsRepository {
  async listByTripWithClient(client: PoolClient, tripId: string): Promise<BackhaulRecord[]> {
    const result = await client.query<BackhaulRow>(`${SELECT} WHERE b.trip_id = $1 ORDER BY b.created_at, b.id`, [tripId]);
    return result.rows.map(toRecord);
  }

  async findWithClient(client: PoolClient, id: string): Promise<BackhaulRecord | null> {
    const result = await client.query<BackhaulRow>(`${SELECT} WHERE b.id = $1`, [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /**
   * A new backhaul — the owner's offer, or one the driver took on the road
   * (accepted as it's added). [id] may come from the phone: the same id
   * again is the same backhaul (a retry), so nothing more is inserted and
   * false comes back.
   */
  async createWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    fields: {
      id: string | null;
      tripId: string;
      pickupPlace: string;
      dropPlace: string;
      rent: string;
      hirerName: string | null;
      notes: string | null;
      offeredBy: 'owner' | 'driver';
    },
  ): Promise<{ id: string; created: boolean }> {
    const accepted = fields.offeredBy === 'driver';
    const result = await client.query<{ id: string }>(
      `INSERT INTO fulfilment.backhaul (id, tenant_id, trip_id, pickup_place, drop_place, rent, hirer_name, notes, offered_by, status, accepted_at, created_by)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        fields.id,
        tenantId,
        fields.tripId,
        fields.pickupPlace,
        fields.dropPlace,
        fields.rent,
        fields.hirerName,
        fields.notes,
        fields.offeredBy,
        accepted ? 'accepted' : 'offered',
        accepted ? new Date() : null,
        actorUserId,
      ],
    );
    if (result.rows[0]) return { id: result.rows[0].id, created: true };
    return { id: fields.id as string, created: false };
  }

  /** Each change below happens once: a backhaul no longer in the state it needs is left as it is (false back). */
  async acceptWithClient(client: PoolClient, id: string, at: Date): Promise<boolean> {
    const result = await client.query(
      `UPDATE fulfilment.backhaul SET status = 'accepted', accepted_at = $2, updated_at = now(), version = version + 1
       WHERE id = $1 AND status = 'offered'`,
      [id, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async skipWithClient(client: PoolClient, id: string, reason: string): Promise<boolean> {
    const result = await client.query(
      `UPDATE fulfilment.backhaul SET status = 'skipped', skip_reason = $2, updated_at = now(), version = version + 1
       WHERE id = $1 AND status = 'offered'`,
      [id, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async cancelWithClient(client: PoolClient, id: string, reason: string | null): Promise<boolean> {
    const result = await client.query(
      `UPDATE fulfilment.backhaul SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now(), version = version + 1
       WHERE id = $1 AND status IN ('offered', 'accepted')`,
      [id, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async stepWithClient(client: PoolClient, id: string, step: BackhaulStep, at: Date): Promise<boolean> {
    const column = STEP_COLUMN[step];
    const status = step === 'completed' ? ", status = 'completed'" : '';
    const result = await client.query(
      `UPDATE fulfilment.backhaul SET ${column} = $2${status}, updated_at = now(), version = version + 1
       WHERE id = $1 AND status = 'accepted' AND ${column} IS NULL`,
      [id, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async payWithClient(
    client: PoolClient,
    id: string,
    actorUserId: string,
    payment: { method: BackhaulPaymentMethod; amount: string; reference: string | null; note: string | null; at: Date },
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE fulfilment.backhaul
          SET payment_method = $2, amount_received = $3, payment_reference = $4, payment_note = $5, paid_at = $6, paid_by = $7,
              updated_at = now(), version = version + 1
       WHERE id = $1 AND status = 'completed' AND paid_at IS NULL`,
      [id, payment.method, payment.amount, payment.reference, payment.note, payment.at, actorUserId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async insertPhotoWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    fields: { backhaulId: string; photoType: BackhaulPhotoType; storageKey: string; contentType: string; sizeBytes: number },
  ): Promise<BackhaulPhotoRecord> {
    const result = await client.query<{
      id: string;
      backhaul_id: string;
      photo_type: BackhaulPhotoType;
      storage_key: string;
      content_type: string;
      size_bytes: number;
      taken_at: Date;
      created_by: string;
    }>(
      `INSERT INTO fulfilment.backhaul_photo (tenant_id, backhaul_id, photo_type, storage_key, content_type, size_bytes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, fields.backhaulId, fields.photoType, fields.storageKey, fields.contentType, fields.sizeBytes, actorUserId],
    );
    const r = result.rows[0];
    return {
      id: r.id,
      backhaulId: r.backhaul_id,
      photoType: r.photo_type,
      storageKey: r.storage_key,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
      takenAt: r.taken_at,
      createdBy: r.created_by,
    };
  }

  /** Backhaul rent received on the trip: in cash (with the driver until the handover), and paid straight to the business. */
  async moneyWithClient(client: PoolClient, tripId: string): Promise<{ cash: string; direct: string }> {
    const result = await client.query<{ cash: string; direct: string }>(
      `SELECT COALESCE(SUM(amount_received) FILTER (WHERE payment_method = 'cash'), 0)::numeric(12,2)::text AS cash,
              COALESCE(SUM(amount_received) FILTER (WHERE payment_method <> 'cash'), 0)::numeric(12,2)::text AS direct
       FROM fulfilment.backhaul WHERE trip_id = $1 AND paid_at IS NOT NULL`,
      [tripId],
    );
    return result.rows[0];
  }
}
