// 'reserved' added for Orders — a whole available lot is claimed for one
// order line at a time (no partial-lot splitting; consistent with specific
// lot costing, Accounting Engine LOT.2). Anticipated in this table's own
// original migration comment: "reserved/... are transitions later modules
// (Orders, ...) will add once they exist."
export type LotStatus = 'received_ungraded' | 'available' | 'reserved' | 'rejected';

export interface LotRecord {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  farmerId: string;
  productId: string;
  pickupId: string | null;
  receivedQuantity: string; // numeric as string — Constitution III.2
  acceptedQuantity: string | null;
  rejectedQuantity: string | null;
  grade: string | null;
  rejectionReason: string | null;
  unitCost: string | null;
  status: LotStatus;
  reservedForOrderLineId: string | null;
  // Set once, at grading, to acceptedQuantity — then the Inventory Engine's
  // running balance: reduced by shrinkage/rejectionPostAcceptance, never by
  // reservation (a whole-lot claim doesn't shrink the lot, it just flags
  // it). null until graded, same as acceptedQuantity.
  currentQuantity: string | null;
  currentLocationId: string | null;
  receivedAt: Date;
  gradedAt: Date | null;
  gradedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
