// The Route: an ordered sequence of stops, each either a farmer pickup
// (Procurement's own commerce.pickup, already scheduled with a
// purchase order and farmer) or a customer delivery (a confirmed
// commerce.customer_order) — never both, never neither.
import { FarmStopOutcome } from './farm-stop.entity';
import { DeliveryOutcome } from './delivery-stop.entity';

export type StopType = 'pickup' | 'delivery';
export type StopStatus = 'pending' | 'completed' | 'skipped';

export interface TripStopRecord {
  id: string;
  tripId: string;
  sequenceNumber: number;
  stopType: StopType;
  pickupId: string | null;
  orderId: string | null;
  status: StopStatus;
  arrivedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  /**
   * Who the stop is for and what it carries — filled in when listing a
   * trip's stops, so the driver app gets a whole route in one call instead
   * of looking up each order, pickup, customer and farmer (which a driver's
   * role can't read anyway — Performance Audit PA-02).
   */
  party?: StopParty | null;
  items?: StopItem[];
  /** For a delivery: what to collect there — the order's value from a cash customer, or nothing on credit. */
  collect?: StopCollect | null;
  /** A completed farm stop: each product accepted or rejected, and its packing crew (driver app D2). */
  farm?: FarmStopOutcome | null;
  /** A completed delivery: its QR, what was delivered short and why, its crates (driver app D3). */
  delivery?: DeliveryOutcome | null;
}

export interface StopCollect {
  terms: 'cash' | 'credit';
  /** The order's value (cash customers pay it at the door). */
  amount: string;
}

export interface StopParty {
  kind: 'customer' | 'farmer';
  id: string;
  name: string;
  phone: string | null;
  /** The village or town; for a delivery, the address it goes to. */
  place: string | null;
  address: string | null;
  /** Its map pin, when the owner has set one — for Navigate and the distance to it. */
  latitude: string | null;
  longitude: string | null;
  /** A customer's QR token: the driver app checks the QR at the door against it (D3). */
  qrToken?: string | null;
}

export interface StopItem {
  productName: string;
  quantity: string;
  uom: string;
  productId: string;
  /** Delivery stops: the order line, for customer-end measures. */
  orderLineId: string | null;
  /** live_bird: the customer's scale may settle it; egg: broken ones come off. */
  kind: 'standard' | 'live_bird' | 'egg';
  packSize: number | null;
}
