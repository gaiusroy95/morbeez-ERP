// Mirrors apps/backend/src/modules/logistics/entities/*.
import type { IsoDate, IsoDateTime } from '../common';

export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'reconciled';

export interface TripRecord {
  id: string;
  vehicleId: string;
  driverEmployeeId: string;
  status: TripStatus;
  plannedDate: IsoDate | null;
  advanceAmount: string;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface TripStopRecord {
  id: string;
  tripId: string;
  sequenceNumber: number;
  stopType: 'pickup' | 'delivery';
  pickupId: string | null;
  orderId: string | null;
  status: 'pending' | 'completed' | 'skipped';
  arrivedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  notes: string | null;
}

export interface TripExpenseRecord {
  id: string;
  tripId: string;
  category: 'fuel' | 'toll' | 'labour' | 'other';
  amount: string;
  notes: string | null;
  recordedAt: IsoDateTime;
}

export interface TripReconciliationRecord {
  id: string;
  tripId: string;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string;
  variance: string;
  notes: string | null;
  reconciledAt: IsoDateTime;
}
