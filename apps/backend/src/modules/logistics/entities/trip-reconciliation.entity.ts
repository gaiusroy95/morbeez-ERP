// Closes out the trip's own cash float, and is posted to the ledger when
// it's recorded (LedgerService.postTripReconciliationWithClient). variance =
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
