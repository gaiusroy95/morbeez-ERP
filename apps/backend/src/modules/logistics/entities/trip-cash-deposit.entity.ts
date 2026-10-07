// Cash a driver paid into a bank account on the road: it leaves the trip's
// float (the driver no longer holds it) for the bank, and is subtracted
// from what they hand over (pilot baseline, money handover case C).
export interface TripCashDepositRecord {
  id: string;
  tripId: string;
  amount: string; // numeric as string — Constitution III.2
  bankAccount: string;
  reference: string;
  depositedAt: Date;
  recordedBy: string;
  recordedAt: Date;
  clientRef: string | null;
}
