import { TripStatus } from './trip.entity';

export type TripsBoardDay = 'today' | 'tomorrow' | 'all';

/** A card on the owner's Trips list (redesign V1.1, screen 7). */
export interface TripCard {
  id: string;
  number: string;
  status: TripStatus;
  /** The planned date, or the day it was made when it has none (YYYY-MM-DD). */
  day: string;
  /** When it set off (in progress) or came back (submitted, closed), HH:MM in the business's time. */
  time: string | null;
  routeName: string | null;
  customers: number;
  farmers: number;
  /** What it carries in kg: the deliveries, or the pickups when it has no deliveries. */
  kg: string;
  vehicle: string;
  driverName: string;
  stops: number;
  stopsDone: number;
}

export interface TripsBoard {
  day: TripsBoardDay;
  counts: { today: number; tomorrow: number; all: number };
  total: number;
  page: number;
  pageSize: number;
  items: TripCard[];
}

export interface PlanItem {
  name: string;
  quantity: string;
  uom: string;
}

/** An order the Create Trip form can put on the trip. */
export interface PlanOrder {
  id: string;
  number: number;
  status: 'placed' | 'confirmed';
  /** Waiting for an approval decision before it can be confirmed. */
  awaitingApproval: boolean;
  customerId: string;
  customerName: string;
  place: string | null;
  deliveryTime: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  /** Its customer's place in the route's visiting order; null when not a stop on it. */
  routePosition: number | null;
  kg: string;
  items: PlanItem[];
  totalValue: string;
}

/** A scheduled pickup the Create Trip form can put on the trip. */
export interface PlanPickup {
  pickupId: string;
  purchaseOrderId: string;
  poNumber: number;
  farmerId: string;
  farmerName: string;
  place: string | null;
  time: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  routePosition: number | null;
  kg: string;
  items: PlanItem[];
}

/**
 * What a trip on [date] along [routeId] could carry: the route's orders
 * for the day (confirmed ones can go; placed ones are shown with why not),
 * other confirmed orders for the day, the route's farmers' pickups, other
 * pickups for the day — none already on an active trip — and, for a chosen
 * vehicle, its capacity and what is on it now.
 */
export interface TripPlan {
  date: string;
  routeId: string | null;
  orders: PlanOrder[];
  otherOrders: PlanOrder[];
  pickups: PlanPickup[];
  otherPickups: PlanPickup[];
  vehicle: { id: string; registrationNumber: string; capacityKg: string; stockKg: string } | null;
}

/**
 * A trip's quantities, product by product: what went on the vehicle for
 * deliveries (loaded from stock), what was picked up from farmers, what
 * reached customers, what came back, and what should be on the vehicle
 * now (loaded + procured − delivered). Once closed, what was counted.
 */
export interface QuantityRow {
  productId: string;
  product: string;
  uom: string;
  /** From the store onto the vehicle when the trip started. */
  loaded: string;
  /** Picked up at farms. */
  procured: string;
  delivered: string;
  spotSold: string;
  /** Back to the store at closing. */
  returned: string;
  /** Missing at closing, written off. */
  writtenOff: string;
  /** What the pending deliveries still ask for. */
  toDeliver: string;
  /** What should be on the vehicle: loaded + procured − delivered − spot sold. */
  expected: string;
  counted: string | null;
  difference: string | null;
}

export interface TripQuantities {
  rows: QuantityRow[];
  /** Totals of the kg rows. */
  totalsKg: {
    loaded: string;
    procured: string;
    delivered: string;
    spotSold: string;
    returned: string;
    writtenOff: string;
    toDeliver: string;
    expected: string;
    counted: string | null;
  };
  /** Closed with a count: did every product match? null while not counted. */
  balanced: boolean | null;
}

/**
 * What's on the trip's vehicle right now (driver app D0), product by
 * product: reserved for this trip's deliveries or free, and what the
 * pending deliveries still need — short when the vehicle can't cover them.
 */
export interface TripVehicleStock {
  tripId: string;
  vehicleId: string;
  registrationNumber: string;
  rows: {
    productId: string;
    product: string;
    uom: string;
    onVehicle: string;
    reserved: string;
    free: string;
    toDeliver: string;
    short: string;
  }[];
  totalsKg: { onVehicle: string; toDeliver: string; short: string };
}

/** One product's line of the vehicle's closing stock, kept with the closure. */
export interface ClosingStockLine {
  productId: string;
  product: string;
  uom: string;
  expected: string;
  counted: string;
}

/**
 * The driver's day (driver app V1, D1 — Start Day and the Dashboard): their
 * trip for today, the vehicle it runs on, the vehicle's last odometer
 * reading (opening KM can't be below it), what they've earned this week and
 * not been paid yet, and what's on the vehicle.
 */
export interface DriverDay {
  /** Today, in the business's timezone. */
  today: string;
  driver: { employeeId: string; name: string } | null;
  trip: import('./trip.entity').TripRecord | null;
  vehicle: { id: string; registrationNumber: string } | null;
  routeName: string | null;
  lastOdometerKm: string | null;
  /** Monday of this week: earnedThisWeek runs from it to today. */
  weekFrom: string;
  earnedThisWeek: string | null;
  vehicleStock: TripVehicleStock | null;
  /** The business's active workers: the packer and loader at a farm stop are chosen from them (driver app D2). */
  crew: import('./farm-stop.entity').CrewOption[];
  /** The business's crate types: crates left and taken back at a delivery (D3). */
  crateTypes: { id: string; code: string; name: string }[];
}
