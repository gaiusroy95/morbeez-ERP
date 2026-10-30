import { PhoneState } from './sync-state';

/** One phone's last report. */
export interface PhoneReport {
  deviceId: string;
  platform: string;
  appVersion: string;
  pendingOperations: number;
  failedOperations: number;
  pendingPhotos: number;
  failedPhotos: number;
  oldestPendingAt: Date | null;
  failures: { type: string; error: string; at: string }[];
  lastResult: 'success' | 'partial';
  syncedAt: Date;
  reportedAt: Date;
  state: PhoneState;
}

/** A driver and their phones (owner Phase 8, Offline Sync). */
export interface DriverPhones {
  employeeId: string;
  name: string;
  phone: string | null;
  onTrip: { id: string; number: string } | null;
  /** The state of the phone heard from last — what the driver's card shows. */
  state: PhoneState;
  devices: PhoneReport[];
}

export interface SyncStatus {
  asOf: Date;
  quietAfterMinutes: number;
  drivers: DriverPhones[];
}
