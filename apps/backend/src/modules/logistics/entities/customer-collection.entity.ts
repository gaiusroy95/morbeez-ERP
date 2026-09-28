export type CollectionMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque';

// The capture of cash/payment collected at a delivery stop: who took what,
// where. Its money side is a Finance customer payment (collection_id links
// the two), applied to the order's invoice and posted to the ledger when
// the collection is recorded.
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
