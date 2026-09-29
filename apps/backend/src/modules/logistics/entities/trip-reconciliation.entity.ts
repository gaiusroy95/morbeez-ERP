// Closes out the trip's own cash float, and is posted to the ledger when
// it's recorded (LedgerService.postTripReconciliationWithClient). variance =
// advanceAmount + spotCash - (totalExpenses + cashReturned): zero means the
// driver fully accounted for the advance and the cash taken for spot sales;
// positive means cash is missing.
export interface TripReconciliationRecord {
  id: string;
  tripId: string;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string;
  spotCash: string; // cash taken for completed spot sales on the trip
  variance: string;
  notes: string | null;
  reconciledBy: string;
  reconciledAt: Date;
}
