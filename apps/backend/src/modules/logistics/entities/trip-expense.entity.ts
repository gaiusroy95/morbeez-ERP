// Ad hoc costs recorded during a trip — fuel, toll, parking, loading
// ('labour'), repair, other. Vehicle and driver's own intrinsic costs
// (depreciation, wages) are a Cost Allocation Engine computation over the
// whole fleet/payroll, not something recorded per trip here.
export type ExpenseCategory = 'fuel' | 'toll' | 'parking' | 'labour' | 'repair' | 'other';

export type FuelType = 'diesel' | 'petrol' | 'cng' | 'electric';

/** A fuel expense's pump details (driver app D6): what the vehicle's mileage is worked out from. */
export interface ExpenseFuel {
  odometerKm: number | null;
  fuelType: FuelType | null;
  fullTank: boolean | null;
  litres: string | null;
  ratePerLitre: string | null;
}

export interface TripExpenseRecord {
  id: string;
  tripId: string;
  category: ExpenseCategory;
  amount: string; // numeric as string — Constitution III.2
  notes: string | null;
  recordedBy: string;
  recordedAt: Date;
  /** The Idempotency-Key it was recorded under, when the client sent one. */
  clientRef: string | null;
  /** Recorded by a driver whose authority doesn't cover expenses (below level 4): the owner approves it at closure. */
  needsApproval: boolean;
  /** The owner's decision on it (owner app Phase 7), with their note; null until decided. */
  decision: 'approved' | 'rejected' | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  /** A fuel expense's pump details; null for every other category, and for fuel recorded without them. */
  fuel: ExpenseFuel | null;
  /** Bill photos kept with it. */
  photos: number;
}

export interface TripExpensePhotoRecord {
  id: string;
  expenseId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: Date;
}
