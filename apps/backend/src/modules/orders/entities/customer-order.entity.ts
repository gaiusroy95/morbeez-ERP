// 'delivered' added for Logistics — a confirmed order's terminal state
// once a Trip's delivery stop for it completes. Inventory consumption and
// any COGS-at-delivery journal entry (Accounting Engine) are deliberately
// not triggered by this transition yet: this only records the operational
// fact that the order reached the customer, the same scope boundary
// Procurement's farmer_settlement drew around itself before a real
// Accounting module existed to post against.
export type OrderStatus = 'placed' | 'confirmed' | 'cancelled' | 'delivered';

export interface OrderLineRecord {
  id: string;
  orderId: string;
  productId: string;
  quantity: string; // numeric as string — Constitution III.2
  unitPrice: string;
}

export interface OrderRecord {
  id: string;
  tenantId: string;
  customerId: string;
  status: OrderStatus;
  approvalRequestId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lines?: OrderLineRecord[];
}
