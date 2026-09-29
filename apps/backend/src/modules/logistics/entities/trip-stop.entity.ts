// The Route: an ordered sequence of stops, each either a farmer pickup
// (Procurement's own commerce.pickup, already scheduled with a
// purchase order and farmer) or a customer delivery (a confirmed
// commerce.customer_order) — never both, never neither.
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
}

export interface StopParty {
  kind: 'customer' | 'farmer';
  id: string;
  name: string;
  phone: string | null;
}

export interface StopItem {
  productName: string;
  quantity: string;
  uom: string;
}
