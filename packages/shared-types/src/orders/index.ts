// Mirrors apps/backend/src/modules/orders/entities/customer-order.entity.ts.
import type { IsoDateTime } from '../common';

export type OrderStatus = 'placed' | 'confirmed' | 'cancelled' | 'delivered';

export interface OrderLineRecord {
  id: string;
  orderId: string;
  productId: string;
  quantity: string;
  unitPrice: string;
}

export interface OrderRecord {
  id: string;
  customerId: string;
  status: OrderStatus;
  approvalRequestId: string | null;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lines?: OrderLineRecord[]; // detail only
  totalValue?: string; // list rows only
}

// Request body. unitPrice is optional: the backend prices an omitted one at
// the product's current basePrice.
export interface CreateOrderBody {
  customerId: string;
  lines: { productId: string; quantity: number; unitPrice?: number }[];
}

/** A new order line's starting price: the last actual price (client Q&A, pricing). */
export interface PriceSuggestion {
  productId: string;
  price: string | null;
  source: 'customer_last' | 'product_last' | 'reference' | null;
  at: string | null;
}
