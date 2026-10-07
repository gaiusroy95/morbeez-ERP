// Ad hoc costs recorded during a trip — fuel/toll/labour/other. Vehicle
// and driver's own intrinsic costs (depreciation, wages) are a Cost
// Allocation Engine computation over the whole fleet/payroll, not
// something recorded per trip here.
export type ExpenseCategory = 'fuel' | 'toll' | 'labour' | 'other';

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
}
