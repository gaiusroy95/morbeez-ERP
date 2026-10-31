// Mirrors apps/backend/src/modules/logistics/entities/*.
import type { IsoDate, IsoDateTime } from '../common';
import type { PaymentMethod } from '../finance';

// 'completed' = submitted by the driver, awaiting the owner's
// reconciliation; 'on_hold' = the owner is looking into it; only the owner
// closes a trip ('reconciled').
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled' | 'reconciled';

export interface TripRecord {
  id: string;
  /** "T-20261028-001": the day's running number. */
  number: string;
  routeId: string | null;
  vehicleId: string;
  driverEmployeeId: string;
  packerEmployeeId: string | null;
  loaderEmployeeId: string | null;
  status: TripStatus;
  plannedDate: IsoDate | null;
  advanceAmount: string;
  startedAt: IsoDateTime | null;
  /** The odometer when the day started (driver app Start Day), and where the phone was. */
  openingKm: string | null;
  startLatitude: string | null;
  startLongitude: string | null;
  /** Start Trip in the driver app: when the delivery run set off. */
  deliveryStartedAt: IsoDateTime | null;
  /** Return in the driver app: the odometer when back, and when; trip KM = closing − opening. */
  closingKm: string | null;
  returnedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  submittedBy: string | null;
  /** Cash the driver said they're handing over. */
  cashDeclared: string | null;
  submitNote: string | null;
  /** The owner's note: why it's on hold, or what the driver must correct. */
  reviewNote: string | null;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TripStopRecord {
  id: string;
  tripId: string;
  sequenceNumber: number;
  stopType: 'pickup' | 'delivery';
  pickupId: string | null;
  orderId: string | null;
  status: 'pending' | 'completed' | 'skipped';
  arrivedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  notes: string | null;
  /** Filled in when listing a trip's stops: who it's for, what it carries, what to collect. */
  party?: {
    kind: 'customer' | 'farmer';
    id: string;
    name: string;
    phone: string | null;
    place: string | null;
    /** For a delivery, the address it goes to. */
    address: string | null;
    latitude: string | null;
    longitude: string | null;
  } | null;
  items?: { productName: string; quantity: string; uom: string }[];
  collect?: { terms: 'cash' | 'credit'; amount: string } | null;
  /** A completed farm stop: each product accepted or rejected, and its packing crew (driver app D2). */
  farm?: FarmStopOutcome | null;
  /** A completed delivery: its QR, what was delivered short and why, its crates (driver app D3). */
  delivery?: DeliveryOutcome | null;
}

export type ShortfallReason = 'customer_took_less' | 'damaged' | 'not_enough_on_vehicle' | 'quality_issue' | 'other';

export interface DeliveryOutcome {
  recipientName: string;
  qrStatus: 'scanned' | 'not_scanned' | null;
  qrNote: string | null;
  allUnloaded: boolean | null;
  shortfalls: { orderLineId: string; productName: string; uom: string; ordered: string; delivered: string; reason: ShortfallReason; note: string | null }[];
  crates: { dropped: number; collected: number };
}

export type FarmRejectReason = 'quality_issue' | 'quantity_short' | 'damaged' | 'farmer_not_ready' | 'other';

export interface FarmStopLine {
  productId: string;
  productName: string;
  uom: string;
  outcome: 'accepted' | 'rejected';
  acceptedQuantity: string;
  rejectedQuantity: string;
  measuredBy: 'weight' | 'bags';
  sacks: number | null;
  kgPerBag: string | null;
  reason: FarmRejectReason | null;
  note: string | null;
}

export interface FarmStopOutcome {
  packer: { employeeId: string; name: string } | null;
  loader: { employeeId: string; name: string } | null;
  lines: FarmStopLine[];
  /** The kilos loaded there: what the packer and loader are credited with. */
  loadedKg: string;
}

/** 'labour' is loading (the driver app's "Loading"). */
export type ExpenseCategory = 'fuel' | 'toll' | 'parking' | 'labour' | 'repair' | 'other';

export type FuelType = 'diesel' | 'petrol' | 'cng' | 'electric';

/** A fuel expense's pump details (driver app D6). */
export interface ExpenseFuel {
  odometerKm: number | null;
  fuelType: FuelType | null;
  fullTank: boolean | null;
  litres: string | null;
  ratePerLitre: string | null;
}

export interface TripExpenseRecord {
  id: string;
  tripId: string;
  category: ExpenseCategory;
  amount: string;
  notes: string | null;
  recordedAt: IsoDateTime;
  /** Spent beyond the driver's authority (below level 4): the owner approves it at closure. */
  needsApproval: boolean;
  /** The owner's decision on it (Approvals inbox), with their note. */
  decision?: 'approved' | 'rejected' | null;
  decisionNote?: string | null;
  decidedAt?: IsoDateTime | null;
  /** Fuel's pump details; null otherwise (driver app D6). */
  fuel?: ExpenseFuel | null;
  /** Bill photos kept with it. */
  photos?: number;
  /** A toll or parking may be taken off the vehicle's FASTag: only cash comes out of the driver's float. */
  paidBy?: 'cash' | 'fastag';
}

// ---- Driver requests (driver app D10) ----

export type DriverRequestKind = 'advance' | 'new_customer' | 'credit_limit';
export type DriverRequestStatus = 'pending' | 'approved' | 'rejected';

export interface NewCustomerDetails {
  name: string;
  phone: string | null;
  place: string | null;
  address: string | null;
  language: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** GET driver-requests/:id — what a driver asked the office for from the road. */
export interface DriverRequest {
  id: string;
  kind: DriverRequestKind;
  status: DriverRequestStatus;
  driverEmployeeId: string;
  driverName: string;
  tripId: string | null;
  tripNumber: string | null;
  amount: string | null;
  customerId: string | null;
  customerName: string | null;
  currentCreditLimit: string | null;
  newCustomer: NewCustomerDetails | null;
  reason: string;
  requestedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  decidedBy: string | null;
  decisionNote: string | null;
  resultRef: string | null;
}

export type ChecklistArea = 'procurement' | 'deliveries' | 'load' | 'collections' | 'handover' | 'expenses' | 'returns' | 'backhaul';

export interface ChecklistItem {
  area: ChecklistArea;
  status: 'pass' | 'exception';
  detail: string;
}

export interface TripReconciliationRecord {
  id: string;
  tripId: string;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string; // cash the owner received at handover
  spotCash: string; // cash taken for spot sales on the trip
  cashCollections: string; // cash collected at deliveries, held by the driver
  backhaulCash: string; // backhaul rent paid to the driver in cash
  cashDeposited: string; // cash the driver paid into the bank on the road
  directPayments: string; // UPI/bank/cheque straight to the business — no handover
  cashDeclared: string | null;
  variance: string; // expected handover − cash received; positive = short
  notes: string | null;
  outcome: 'pass' | 'approved_exception';
  exceptionNote: string | null;
  checklist: ChecklistItem[] | null;
  /** What was counted on the vehicle at closing; null when not counted. */
  closingStock?: ClosingStockLine[] | null;
  reconciledAt: IsoDateTime;
}

/** What the driver should hand over: opening cash + cash collected + spot cash + backhaul cash − expenses − bank deposits. */
export interface HandoverSummary {
  openingCash: string;
  cashCollections: string;
  spotCash: string;
  /** Backhaul rent paid to the driver in cash (driver app D5). */
  backhaulCash: string;
  expenses: string;
  deposited: string;
  expected: string;
  declared: string | null;
  directPayments: string;
}

export interface TripLoadLine {
  product: string;
  uom: string;
  pickedUp: string;
  delivered: string;
  returned: string;
}

/** Everything the owner checks before closing a submitted trip. */
export interface TripReview {
  trip: TripRecord;
  handover: HandoverSummary;
  checklist: ChecklistItem[];
  load: TripLoadLine[];
  pendingSpotSales: number;
  exceptions: number;
}

export interface TripCashDepositRecord {
  id: string;
  tripId: string;
  amount: string;
  bankAccount: string;
  reference: string;
  depositedAt: IsoDateTime;
}

export interface CustomerCollectionRecord {
  id: string;
  tripStopId: string;
  orderId: string;
  amount: string;
  method: PaymentMethod;
  notes: string | null;
  collectedAt: IsoDateTime;
  /** Who paid: the customer, or someone on their behalf (driver app D4). */
  payer: 'customer' | 'third_party';
  payerName: string | null;
  /** UPI or transfer: its reference (UTR). */
  reference: string | null;
}

/** GET logistics/trips/:id/collections — the customers delivered on the trip, each with what they owe in all. */
export interface TripCollections {
  tripId: string;
  customers: {
    customerId: string;
    name: string;
    phone: string | null;
    place: string | null;
    stopId: string;
    terms: 'cash' | 'credit';
    outstanding: string;
    disputed: string;
    collectedOnTrip: string;
  }[];
  collected: { cash: string; upi: string; bankTransfer: string; cheque: string; total: string };
  pending: { customers: number; amount: string };
}

// ---- Backhaul (driver app D5) ----

export type BackhaulStatus = 'offered' | 'accepted' | 'skipped' | 'cancelled' | 'completed';
export type BackhaulStep = 'pickup_reached' | 'loaded' | 'drop_reached' | 'completed';
export type BackhaulPaymentMethod = 'cash' | 'upi' | 'bank_transfer';

/** GET logistics/trips/:id/backhauls — a fixed-rent job on the way back: no product, no kilos, no stock. */
export interface BackhaulRecord {
  id: string;
  tripId: string;
  pickupPlace: string;
  dropPlace: string;
  rent: string;
  hirerName: string | null;
  notes: string | null;
  /** The owner offered it, or the driver took it on the road. */
  offeredBy: 'owner' | 'driver';
  status: BackhaulStatus;
  skipReason: string | null;
  acceptedAt: IsoDateTime | null;
  pickupReachedAt: IsoDateTime | null;
  loadedAt: IsoDateTime | null;
  dropReachedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  payment: { method: BackhaulPaymentMethod; amount: string; reference: string | null; note: string | null; paidAt: IsoDateTime } | null;
  photos: { load: number; drop: number; payment: number };
  createdAt: IsoDateTime;
  version: number;
}

export interface CreateBackhaulBody {
  pickupPlace: string;
  dropPlace: string;
  rent: number;
  hirerName?: string;
  notes?: string;
}

export interface BackhaulPaymentBody {
  method: BackhaulPaymentMethod;
  amount: number;
  reference?: string;
  note?: string;
}

// Request bodies.
export interface CreateTripBody {
  vehicleId: string;
  driverEmployeeId: string;
  plannedDate?: IsoDate;
  advanceAmount?: number;
  routeId?: string;
  packerEmployeeId?: string;
  loaderEmployeeId?: string;
  /** Confirmed orders and scheduled pickups it carries; stops are made in the route's order. */
  orderIds?: string[];
  pickupIds?: string[];
}

export interface ReconcileTripBody {
  version: number;
  cashReturned: number;
  notes?: string;
  /** Required to close when anything checked is an exception. */
  exceptionNote?: string;
  /** What was counted on the vehicle, product by product (left out: none). */
  closingStock?: { productId: string; quantity: number }[];
}

export interface TripDecisionBody {
  version: number;
  note: string;
}

// ---- Trips list and planning (redesign Phase 4) ----

export type TripsBoardDay = 'today' | 'tomorrow' | 'all';

export interface TripCard {
  id: string;
  number: string;
  status: TripStatus;
  day: IsoDate;
  /** Set off (in progress) or came back (submitted, closed), HH:MM. */
  time: string | null;
  routeName: string | null;
  customers: number;
  farmers: number;
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

export interface PlanOrder {
  id: string;
  number: number;
  status: 'placed' | 'confirmed';
  awaitingApproval: boolean;
  customerId: string;
  customerName: string;
  place: string | null;
  deliveryTime: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  routePosition: number | null;
  kg: string;
  items: PlanItem[];
  totalValue: string;
}

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

/** GET logistics/trips/plan: what a trip on a day along a route could carry. */
export interface TripPlan {
  date: IsoDate;
  routeId: string | null;
  orders: PlanOrder[];
  otherOrders: PlanOrder[];
  pickups: PlanPickup[];
  otherPickups: PlanPickup[];
  vehicle: { id: string; registrationNumber: string; capacityKg: string; stockKg: string } | null;
}

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

/** GET logistics/trips/:id/quantities. */
export interface TripQuantities {
  rows: QuantityRow[];
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
  balanced: boolean | null;
}

/** GET logistics/trips/:id/vehicle-stock — what's on the trip's vehicle now. */
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

export interface ClosingStockLine {
  productId: string;
  product: string;
  uom: string;
  expected: string;
  counted: string;
}

// ---- Workforce & Vehicles (owner app redesign Phase 7) ----

/** GET logistics/trips/on-the-road — trips on the road now, with their crew. */
export interface OnTheRoad {
  tripId: string;
  number: string;
  vehicleId: string;
  driverEmployeeId: string;
  packerEmployeeId: string | null;
  loaderEmployeeId: string | null;
  startedAt: IsoDateTime | null;
  routeName: string | null;
}

/** GET logistics/trips/vehicles/:vehicleId — a vehicle's trips. */
export interface VehicleTrips {
  vehicleId: string;
  trips: number;
  km: string;
  current: string | null;
  crew: { driverName: string; driverPhone: string | null; packerName: string | null } | null;
  recent: { id: string; number: string; status: TripStatus; day: IsoDate; routeName: string | null; km: string | null; driverName: string }[];
}
