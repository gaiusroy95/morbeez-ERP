// Closes out the trip's own cash float — not a double-entry posting
// (Accounting doesn't exist as an implemented ledger yet; same scope
// boundary Procurement drew around money.farmer_settlement). variance =
// advanceAmount - (totalExpenses + cashReturned): zero means the driver
// fully accounted for the advance; positive means cash is missing.
export interface TripReconciliationRecord {
  id: string;
  tripId: string;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string;
  variance: string;
  notes: string | null;
  reconciledBy: string;
  reconciledAt: Date;
}
