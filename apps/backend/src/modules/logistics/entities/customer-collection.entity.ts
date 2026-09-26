export type CollectionMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque';

// An operational fact — cash/payment collected at delivery — not a
// double-entry posting; the delivery-side mirror of Procurement's
// money.farmer_settlement, and drawn the same scope boundary until a real
// Accounting ledger exists to post against.
export interface CustomerCollectionRecord {
  id: string;
  tenantId: string;
  tripStopId: string;
  orderId: string;
  amount: string; // numeric as string — Constitution III.2
  method: CollectionMethod;
  notes: string | null;
  collectedBy: string;
  collectedAt: Date;
}
