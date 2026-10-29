export type OrdersBoardDay = 'today' | 'tomorrow' | 'all';

/**
 * The status pill on a Delivery Orders card: not yet on a trip (pending),
 * on a trip that hasn't left (scheduled), on the road (in_transit),
 * delivered (completed) — or waiting for approval, or cancelled.
 */
export type OrderStage = 'awaiting_approval' | 'pending' | 'scheduled' | 'in_transit' | 'completed' | 'cancelled';

export interface OrderCard {
  id: string;
  number: number;
  status: string;
  stage: OrderStage;
  /** The delivery date, or the day it was taken when it has none (YYYY-MM-DD). */
  day: string;
  deliveryTime: string | null; // HH:MM
  customerName: string;
  customerPlace: string | null;
  routeName: string | null;
  /** The trip's driver and vehicle once on a trip, else the ones planned on the order. */
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
