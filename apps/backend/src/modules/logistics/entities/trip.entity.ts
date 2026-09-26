// planned -> in_progress -> completed -> reconciled, or cancelled from
// planned/in_progress. 'completed' requires every stop to be
// completed/skipped first (checked in the service, not auto-derived — a
// dispatcher/driver action, not something that happens on its own);
// 'reconciled' requires a TripReconciliationRecord to exist.
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'reconciled';

export interface TripRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  driverEmployeeId: string;
  status: TripStatus;
  plannedDate: string | null; // date as ISO string
  advanceAmount: string; // numeric as string — Constitution III.2
  startedAt: Date | null;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
