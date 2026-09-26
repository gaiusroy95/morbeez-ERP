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
}
