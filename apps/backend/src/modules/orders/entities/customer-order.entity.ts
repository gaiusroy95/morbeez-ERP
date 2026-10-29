// 'delivered' added for Logistics: a confirmed order's terminal state once
// a Trip's delivery stop for it completes. Delivery takes the delivered
// kilos out of stock (those reserved for the line first), and Finance
// issues its invoice and posts revenue and cost of goods, in one
// transaction (OrdersService.markDelivered).
export type OrderStatus = 'placed' | 'confirmed' | 'cancelled' | 'delivered';

export interface OrderLineRecord {
  id: string;
  orderId: string;
  productId: string;
  quantity: string; // numeric as string — Constitution III.2
  unitPrice: string;
  /** What left with the delivery; null until delivered. */
  deliveredQuantity: string | null;
}

export interface OrderRecord {
  id: string;
  tenantId: string;
  /** The running number shown as D-00231 (per business, never reused). */
  number: number;
  customerId: string;
  status: OrderStatus;
  // The delivery plan (redesign Phase 3): when, on which route, by whom.
  deliveryDate: string | null; // YYYY-MM-DD
  deliveryTime: string | null; // HH:MM, the business's own time
  routeId: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  /** Where to deliver this order (defaults to the customer's address). */
  deliveryAddress: string | null;
  /** Days to pay agreed on this order; null: the customer's usual terms. */
  creditTermDays: number | null;
  notes: string | null;
  approvalRequestId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lines?: OrderLineRecord[];
  totalValue?: string; // list rows only: sum(quantity * unit_price)
}
