// 'delivered' added for Logistics: a confirmed order's terminal state once
// a Trip's delivery stop for it completes. Delivery consumes the lots
// reserved for the order (reserved -> delivered), and Finance issues its
// invoice and posts revenue and cost of goods, in one transaction
// (OrdersService.markDelivered).
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
  totalValue?: string; // list rows only: sum(quantity * unit_price)
}
