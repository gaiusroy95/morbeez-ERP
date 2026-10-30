// Driver phones' offline sync (owner Phase 8). Mirrors apps/backend/src/modules/devices/devices.entity.ts.
import type { IsoDateTime } from '../common';

export type PhoneState = 'synced' | 'waiting' | 'stuck' | 'quiet' | 'never';

export interface PhoneReport {
  deviceId: string;
  platform: string;
  appVersion: string;
  pendingOperations: number;
  failedOperations: number;
  pendingPhotos: number;
  failedPhotos: number;
  oldestPendingAt: IsoDateTime | null;
  failures: { type: string; error: string; at: IsoDateTime }[];
  lastResult: 'success' | 'partial';
  syncedAt: IsoDateTime;
  reportedAt: IsoDateTime;
  state: PhoneState;
}

export interface DriverPhones {
  employeeId: string;
  name: string;
  phone: string | null;
  onTrip: { id: string; number: string } | null;
  state: PhoneState;
  devices: PhoneReport[];
}

export interface SyncStatus {
  asOf: IsoDateTime;
  quietAfterMinutes: number;
  drivers: DriverPhones[];
}
