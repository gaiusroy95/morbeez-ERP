// The owner's closure of a trip: its cash float settled, posted to the
// ledger when recorded (LedgerService.postTripReconciliationWithClient), and
// what was checked. variance = expected handover − cashReturned, where
// expected handover = advanceAmount + cashCollections + spotCash −
// totalExpenses − cashDeposited: zero means the driver handed over exactly
// what they held; positive means cash is missing.
export type ClosureOutcome = 'pass' | 'approved_exception';

export interface ChecklistItem {
  area: ChecklistArea;
  status: 'pass' | 'exception';
  detail: string;
}

export type ChecklistArea =
  | 'procurement'
  | 'deliveries'
  | 'load'
  | 'collections'
  | 'handover'
  | 'expenses'
  | 'returns';

export interface TripReconciliationRecord {
  id: string;
  tripId: string;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string;
  spotCash: string; // cash taken for completed spot sales on the trip
  cashCollections: string; // cash collected at delivery stops, held by the driver
  cashDeposited: string; // cash the driver paid into the bank on the road
  directPayments: string; // UPI/bank/cheque paid by customers on the trip — no handover
  cashDeclared: string | null; // what the driver said they were handing over
  variance: string;
  outcome: ClosureOutcome;
  exceptionNote: string | null;
  checklist: ChecklistItem[] | null;
  notes: string | null;
  reconciledBy: string;
  reconciledAt: Date;
}
