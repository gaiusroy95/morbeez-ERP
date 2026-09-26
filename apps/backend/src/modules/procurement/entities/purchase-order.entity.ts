export type PurchaseOrderStatus =
  | 'placed'
  | 'confirmed'
  | 'cancelled'
  | 'received'
  | 'graded'
  | 'closed';

export interface PurchaseOrderLineRecord {
  id: string;
  purchaseOrderId: string;
  productId: string;
  expectedQuantity: string; // numeric as string — Constitution III.2
  indicativePrice: string;
}

export interface PurchaseOrderRecord {
  id: string;
  tenantId: string;
  farmerId: string;
  status: PurchaseOrderStatus;
  expectedDeliveryDate: string | null;
  approvalRequestId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lines?: PurchaseOrderLineRecord[];
  // List rows only: sum(expected_quantity * indicative_price) — what the PO
  // was expected to cost, not what grading fixed.
  expectedValue?: string;
}
