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
  /** Entered by the bag: how many, and kg in each (expectedQuantity = bags × kgPerBag). */
  bags: string | null;
  kgPerBag: string | null;
}

export interface PurchaseOrderRecord {
  id: string;
  tenantId: string;
  farmerId: string;
  /** Running number per business; shown as P-00123. */
  number: number;
  status: PurchaseOrderStatus;
  /** The pickup plan; becomes a scheduled pickup once the order is confirmed. */
  pickupDate: string | null;
  /** HH:MM, the tenant's local time. */
  pickupTime: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  agentId: string | null;
  commissionPerKg: string | null;
  notes: string | null;
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
