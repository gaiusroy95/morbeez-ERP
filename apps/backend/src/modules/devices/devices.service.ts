import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { DevicesRepository } from './devices.repository';
import { SyncReportDto } from './devices.dto';
import { PhoneReport, SyncStatus } from './devices.entity';
import { phoneState, QUIET_AFTER_MINUTES } from './sync-state';

/**
 * Driver phones' offline sync (owner Phase 8; the client's Offline Sync
 * screen). The driver app keeps every action on the phone until the server
 * has it (Driver App Architecture, DRV.5); after each sync pass it says
 * what's still on it and what the server refused. The owner sees, per
 * driver, a phone that hasn't sent the day's work — and why.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DevicesRepository,
  ) {}

  /** A phone's report on itself, for the login using it. */
  async report(tenantId: string, userId: string, dto: SyncReportDto): Promise<{ received: true }> {
    if (dto.failedOperations > dto.pendingOperations || dto.failedPhotos > dto.pendingPhotos) {
      throw new BadRequestException('Refused actions and photos are among those still on the phone');
    }
    const now = new Date();
    const syncedAt = new Date(dto.syncedAt);
    await this.db.withTenant(tenantId, (client) => this.repo.saveWithClient(client, tenantId, userId, dto, syncedAt > now ? now : syncedAt));
    return { received: true };
  }

  /** Every active driver and their phones, the one heard from last first. */
  async status(tenantId: string): Promise<SyncStatus> {
    const now = new Date();
    return this.db.withTenant(tenantId, async (client) => {
      const drivers = await this.repo.driversWithClient(client);
      const rows = await this.repo.devicesWithClient(client, drivers.map((d) => d.user_id).filter((u): u is string => !!u));
      return {
        asOf: now,
        quietAfterMinutes: QUIET_AFTER_MINUTES,
        drivers: drivers.map((d) => {
          const devices: PhoneReport[] = rows
            .filter((r) => r.user_id === d.user_id)
            .map((r) => {
              const last = {
                pendingOperations: r.pending_operations,
                failedOperations: r.failed_operations,
                pendingPhotos: r.pending_photos,
                failedPhotos: r.failed_photos,
                reportedAt: r.reported_at,
              };
              return {
                deviceId: r.device_id,
                platform: r.platform,
                appVersion: r.app_version,
                ...last,
                oldestPendingAt: r.oldest_pending_at,
                failures: r.failures,
                lastResult: r.last_result,
                syncedAt: r.synced_at,
                state: phoneState(last, now),
              };
            });
          return {
            employeeId: d.employee_id,
            name: d.name,
            phone: d.phone,
            onTrip: d.trip_id ? { id: d.trip_id, number: d.trip_number as string } : null,
            state: devices[0]?.state ?? 'never',
            devices,
          };
        }),
      };
    });
  }
}
