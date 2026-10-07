// Mirrors apps/backend/src/modules/logistics/entities/*.
import type { IsoDate, IsoDateTime } from '../common';
import type { PaymentMethod } from '../finance';

// 'completed' = submitted by the driver, awaiting the owner's
// reconciliation; 'on_hold' = the owner is looking into it; only the owner
// closes a trip ('reconciled').
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled' | 'reconciled';

export interface TripRecord {
  id: string;
  vehicleId: string;
  driverEmployeeId: string;
  status: TripStatus;
  plannedDate: IsoDate | null;
  advanceAmount: string;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  submittedBy: string | null;
  /** Cash the driver said they're handing over. */
  cashDeclared: string | null;
  submitNote: string | null;
  /** The owner's note: why it's on hold, or what the driver must correct. */
  reviewNote: string | null;
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
  /** Filled in when listing a trip's stops: who it's for, what it carries, what to collect. */
  party?: { kind: 'customer' | 'farmer'; id: string; name: string; phone: string | null } | null;
  items?: { productName: string; quantity: string; uom: string }[];
  collect?: { terms: 'cash' | 'credit'; amount: string } | null;
}

export type ExpenseCategory = 'fuel' | 'toll' | 'labour' | 'other';

export interface TripExpenseRecord {
  id: string;
  tripId: string;
  category: ExpenseCategory;
  amount: string;
  notes: string | null;
  recordedAt: IsoDateTime;
  /** Spent beyond the driver's authority (below level 4): the owner approves it at closure. */
  needsApproval: boolean;
}

export type ChecklistArea = 'procurement' | 'deliveries' | 'load' | 'collections' | 'handover' | 'expenses' | 'returns';

export interface ChecklistItem {
  area: ChecklistArea;
  status: 'pass' | 'exception';
  detail: string;
}

export interface TripReconciliationRecord {
  id: string;
  tripId: string;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string; // cash the owner received at handover
  spotCash: string; // cash taken for spot sales on the trip
  cashCollections: string; // cash collected at deliveries, held by the driver
  cashDeposited: string; // cash the driver paid into the bank on the road
  directPayments: string; // UPI/bank/cheque straight to the business — no handover
  cashDeclared: string | null;
  variance: string; // expected handover − cash received; positive = short
  notes: string | null;
  outcome: 'pass' | 'approved_exception';
  exceptionNote: string | null;
  checklist: ChecklistItem[] | null;
  reconciledAt: IsoDateTime;
}

/** What the driver should hand over: opening cash + cash collected + spot cash − expenses − bank deposits. */
export interface HandoverSummary {
  openingCash: string;
  cashCollections: string;
  spotCash: string;
  expenses: string;
  deposited: string;
  expected: string;
  declared: string | null;
  directPayments: string;
}

export interface TripLoadLine {
  product: string;
  uom: string;
  pickedUp: string;
  delivered: string;
  returned: string;
}

/** Everything the owner checks before closing a submitted trip. */
export interface TripReview {
  trip: TripRecord;
  handover: HandoverSummary;
  checklist: ChecklistItem[];
  load: TripLoadLine[];
  pendingSpotSales: number;
  exceptions: number;
}

export interface TripCashDepositRecord {
  id: string;
  tripId: string;
  amount: string;
  bankAccount: string;
  reference: string;
  depositedAt: IsoDateTime;
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
  /** Required to close when anything checked is an exception. */
  exceptionNote?: string;
}

export interface TripDecisionBody {
  version: number;
  note: string;
}
