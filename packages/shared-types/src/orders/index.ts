// Mirrors apps/backend/src/modules/orders/entities/customer-order.entity.ts.
import type { IsoDate, IsoDateTime } from '../common';

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
  /** Shown as D-00231. */
  number: number;
  customerId: string;
  status: OrderStatus;
  // The delivery plan (redesign Phase 3).
  deliveryDate: IsoDate | null;
  deliveryTime: string | null; // HH:MM
  routeId: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  deliveryAddress: string | null;
  /** Days to pay agreed on this order; null: the customer's usual terms. */
  creditTermDays: number | null;
  notes: string | null;
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
  deliveryDate?: IsoDate;
  deliveryTime?: string;
  routeId?: string;
  driverEmployeeId?: string;
  vehicleId?: string;
  /** Left out: the customer's own address. */
  deliveryAddress?: string;
  /** Longer than the customer's usual terms needs customers:credit. */
  creditTermDays?: number;
  notes?: string;
  /** "Save Order": confirm straight away; if credit or stock refuses, it is saved unconfirmed with confirmProblem. */
  confirm?: boolean;
}

/** POST /orders answers with the order, and why it isn't confirmed when "Save Order" couldn't confirm it. */
export type CreatedOrder = OrderRecord & { confirmProblem?: string };

/** The status pill on a Delivery Orders card. */
export type OrderStage = 'awaiting_approval' | 'pending' | 'scheduled' | 'in_transit' | 'completed' | 'cancelled';
export type OrdersBoardDay = 'today' | 'tomorrow' | 'all';

export interface OrderCard {
  id: string;
  number: number;
  status: OrderStatus;
  stage: OrderStage;
  day: IsoDate;
  deliveryTime: string | null;
  customerName: string;
  customerPlace: string | null;
  routeName: string | null;
  driverName: string | null;
  vehicle: string | null;
  products: { name: string; quantity: string; uom: string }[];
  totalValue: string;
}

export interface OrdersBoard {
  day: OrdersBoardDay;
  counts: { today: number; tomorrow: number; all: number };
  total: number;
  page: number;
  pageSize: number;
  items: OrderCard[];
}

/** A delivery route ("Mysuru North"). */
export interface RouteRecord {
  id: string;
  name: string;
  status: 'active' | 'archived';
  /** How many customers and farmers are stops on it. */
  customers: number;
  farmers: number;
}

/** A customer or farmer on a route, in visiting order. */
export interface RouteStopRecord {
  position: number;
  kind: 'customer' | 'farmer';
  partyId: string;
  name: string;
  place: string | null;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
  status: 'active' | 'archived';
}

/** A new order line's starting price: the last actual price (client Q&A, pricing). */
export interface PriceSuggestion {
  productId: string;
  price: string | null;
  source: 'customer_last' | 'product_last' | 'reference' | null;
  at: string | null;
}
