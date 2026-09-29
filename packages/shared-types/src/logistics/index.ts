// Mirrors apps/backend/src/modules/logistics/entities/*.
import type { IsoDate, IsoDateTime } from '../common';
import type { PaymentMethod } from '../finance';

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
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
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

export type ExpenseCategory = 'fuel' | 'toll' | 'labour' | 'other';

export interface TripExpenseRecord {
  id: string;
  tripId: string;
  category: ExpenseCategory;
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
  spotCash: string; // cash taken for spot sales on the trip
  variance: string; // advance + spot cash − (expenses + cash returned); positive = short
  notes: string | null;
  reconciledAt: IsoDateTime;
}

export interface CustomerCollectionRecord {
  id: string;
  tripStopId: string;
  orderId: string;
  amount: string;
  method: PaymentMethod;
  notes: string | null;
  collectedAt: IsoDateTime;
}

// Request bodies.
export interface CreateTripBody {
  vehicleId: string;
  driverEmployeeId: string;
  plannedDate?: IsoDate;
  advanceAmount?: number;
}

export interface ReconcileTripBody {
  version: number;
  cashReturned: number;
  notes?: string;
}
