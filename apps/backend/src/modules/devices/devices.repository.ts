import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { SyncReportDto } from './devices.dto';

export interface DeviceRow {
  user_id: string;
  device_id: string;
  platform: string;
  app_version: string;
  pending_operations: number;
  failed_operations: number;
  pending_photos: number;
  failed_photos: number;
  oldest_pending_at: Date | null;
  failures: { type: string; error: string; at: string }[];
  last_result: 'success' | 'partial';
  synced_at: Date;
  reported_at: Date;
}

/** Driver phones' sync reports (owner Phase 8): RLS scopes every statement to the tenant. */
@Injectable()
export class DevicesRepository {
  /** The phone's latest word replaces its last. */
  async saveWithClient(client: PoolClient, tenantId: string, userId: string, r: SyncReportDto, syncedAt: Date): Promise<void> {
    await client.query(
      `INSERT INTO identity.device_sync (tenant_id, user_id, device_id, platform, app_version, pending_operations, failed_operations,
                                         pending_photos, failed_photos, oldest_pending_at, failures, last_result, synced_at, reported_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       ON CONFLICT (user_id, device_id) DO UPDATE SET
         platform = EXCLUDED.platform, app_version = EXCLUDED.app_version,
         pending_operations = EXCLUDED.pending_operations, failed_operations = EXCLUDED.failed_operations,
         pending_photos = EXCLUDED.pending_photos, failed_photos = EXCLUDED.failed_photos,
         oldest_pending_at = EXCLUDED.oldest_pending_at, failures = EXCLUDED.failures, last_result = EXCLUDED.last_result,
         synced_at = EXCLUDED.synced_at, reported_at = now()`,
      [
        tenantId, userId, r.deviceId, r.platform, r.appVersion, r.pendingOperations, r.failedOperations, r.pendingPhotos, r.failedPhotos,
        r.oldestPendingAt ?? null, JSON.stringify(r.failures), r.lastResult, syncedAt,
      ],
    );
  }

  /** Every active driver, the login they sign in with (its phone, when their worker record has none), and the trip they're on. */
  async driversWithClient(client: PoolClient): Promise<{ employee_id: string; name: string; phone: string | null; user_id: string | null; trip_id: string | null; trip_number: string | null }[]> {
    const r = await client.query(
      `SELECT e.id AS employee_id, e.name, COALESCE(wp.phone, u.phone) AS phone, e.user_id, trip.id AS trip_id, trip.number AS trip_number
       FROM trading_partners.employee e
       LEFT JOIN workforce.worker_profile wp ON wp.employee_id = e.id
       LEFT JOIN identity.app_user u ON u.id = e.user_id
       LEFT JOIN LATERAL (SELECT t.id, t.number FROM fulfilment.trip t WHERE t.driver_employee_id = e.id AND t.status = 'in_progress'
                          ORDER BY t.started_at DESC NULLS LAST LIMIT 1) trip ON true
       WHERE e.role_type = 'driver' AND e.status = 'active'
       ORDER BY e.name`,
    );
    return r.rows;
  }

  async devicesWithClient(client: PoolClient, userIds: string[]): Promise<DeviceRow[]> {
    if (!userIds.length) return [];
    const r = await client.query<DeviceRow>('SELECT * FROM identity.device_sync WHERE user_id = ANY($1::uuid[]) ORDER BY reported_at DESC', [userIds]);
    return r.rows;
  }
}
