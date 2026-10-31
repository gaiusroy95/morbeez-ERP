// The driver's own records (driver app V1, D6): their expenses with the
// vehicle's mileage, what waits on the owner, past trips and one trip in
// full, the vehicle they drive, and who they are. Read-only; a driver only
// ever sees their own. Read by the driver app alone (its Dtos.kt).

import { ExpenseCategory, TripExpenseRecord } from './trip-expense.entity';
import { TripRecord } from './trip.entity';
import { TripStopRecord } from './trip-stop.entity';
import { TripCollections } from './trip-collections.entity';
import { BackhaulRecord } from './backhaul.entity';
import { FullTankMileage } from '../../vehicles/fleet-math';

/** recorded: within the driver's authority, nothing to approve. */
export type DriverExpenseStatus = 'recorded' | 'pending' | 'approved' | 'rejected';

export interface DriverExpense extends TripExpenseRecord {
  tripNumber: string;
  status: DriverExpenseStatus;
}

export interface VehicleMileage {
  vehicleId: string;
  registrationNumber: string;
  /** The latest full tank to full tank. */
  last: FullTankMileage | null;
  /** Over the last 90 days, full tank to full tank. */
  averageKmPerLitre: string | null;
}

export interface MyExpenses {
  from: string;
  to: string;
  items: DriverExpense[];
  totals: { all: string; fuel: string; other: string };
  mileage: VehicleMileage | null;
}

export type DriverApprovalKind = 'expense' | 'collection' | 'handover' | 'advance' | 'new_customer' | 'credit_limit';
export type DriverApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Something the driver raised that the owner decides: an expense beyond
 * their authority, a customer's dispute, a trip handed over.
 */
export interface DriverApproval {
  id: string;
  kind: DriverApprovalKind;
  status: DriverApprovalStatus;
  /** A handover sent back has no cash declared any more: null. */
  amount: string | null;
  /** An expense's category; null for the others. */
  category: ExpenseCategory | null;
  /** The customer disputing; null for the others. */
  customerName: string | null;
  /** The expense's note, the dispute's reason. */
  detail: string | null;
  tripId: string | null;
  tripNumber: string | null;
  at: Date;
  decidedAt: Date | null;
  /** The owner's word: why rejected, how settled, what to fix. */
  note: string | null;
  photos: number;
}

export interface DriverApprovals {
  since: string;
  items: DriverApproval[];
  counts: Record<DriverApprovalStatus, number>;
}

export interface DriverTripCard {
  id: string;
  number: string;
  day: string | null;
  status: TripRecord['status'];
  routeName: string | null;
  /** The stops' places in the order visited, a place repeated in a row once. */
  places: string[];
  procurement: { done: number; total: number };
  delivery: { done: number; total: number };
  collected: string;
  backhaulReceived: string;
  km: string | null;
  startedAt: Date | null;
  /** Back at the base (Return), else handed over. */
  endedAt: Date | null;
  minutes: number | null;
  fuelLitres: string;
}

export interface TripHistory {
  from: string;
  to: string;
  trips: DriverTripCard[];
}

export interface DriverTripSummary {
  card: DriverTripCard;
  trip: TripRecord;
  vehicle: { id: string; registrationNumber: string; makeModel: string | null };
  stops: TripStopRecord[];
  collections: TripCollections | null;
  backhauls: BackhaulRecord[];
  expenses: TripExpenseRecord[];
  totals: { expenses: string; fuel: string; tolls: string; kmPerLitre: string | null };
  /** The owner's close: when and by whom. */
  closed: { at: Date; by: string | null } | null;
  /** What the driver earned on it (D7): kept at the close, else an estimate. */
  incentives: TripIncentives;
}

export type DueState = 'ok' | 'due_soon' | 'overdue';

export interface DriverMaintenanceDue {
  kind: string;
  description: string;
  lastDate: string;
  lastKm: number | null;
  nextDueDate: string | null;
  nextDueKm: number | null;
  kmLeft: number | null;
  daysLeft: number | null;
  state: DueState;
}

export interface DriverDocument {
  docType: string;
  validUntil: string | null;
  daysLeft: number | null;
  state: 'valid' | 'expiring' | 'expired' | 'no_expiry';
}

/** The vehicle the driver drives: what's due and what's in force — no books, loans or hire. */
export interface DriverVehicle {
  id: string;
  registrationNumber: string;
  makeModel: string | null;
  manufactureYear: number | null;
  fuelType: string;
  ownership: 'owned' | 'hired';
  status: string;
  fitForTrips: boolean;
  issues: string[];
  currentKm: string | null;
  averageKmPerLitre: string | null;
  lastFullTank: FullTankMileage | null;
  maintenance: DriverMaintenanceDue[];
  documents: DriverDocument[];
  /** What's on the vehicle's FASTag, and whether it's below the owner's threshold; null with no tag. */
  fastag: { balance: string; low: boolean } | null;
}

/** The vehicle the driver drives; null before their first trip. */
export interface MyVehicle {
  vehicle: DriverVehicle | null;
}

export interface DriverProfile {
  employeeId: string | null;
  name: string | null;
  phone: string | null;
  joinedOn: string | null;
  businessName: string;
  vehicle: string | null;
  /** Who to call at the business: its owners. */
  contacts: { name: string; phone: string }[];
}

// ---- Incentives and earnings (driver app D7) ----

export interface TripIncentiveLine {
  kind: string;
  label: string;
  base: string;
  percent: string;
  amount: string;
  /** Why it is what it is ("₹1,52,000 collected", "No backhaul paid"). */
  detail: string;
}

/** A trip's incentives: kept at the owner's close ([final]), or what it would pay now. */
export interface TripIncentives {
  tripId: string;
  tripNumber: string;
  final: boolean;
  lines: TripIncentiveLine[];
  total: string;
}

export type EarningsPeriod = 'today' | 'week' | 'month';

/** My Earnings: fixed pay and each incentive over a period — calculated, never entered. */
export interface MyEarnings {
  period: EarningsPeriod;
  from: string;
  to: string;
  fixedPay: string;
  /** Each incentive the owner pays, summed over the period's trips; [estimated] is the part from trips not yet closed. */
  lines: { kind: string; label: string; amount: string; estimated: string; trips: number }[];
  incentives: string;
  estimated: string;
  total: string;
  /** The rules in force, for "₹350 if completed". */
  rules: { kind: string; percent: string }[];
}

/** A settlement of the driver's pay, as they see it: approved or paid, and whether they said they got it. */
export interface DriverSettlement {
  id: string;
  number: number;
  periodStart: string;
  periodEnd: string;
  status: 'approved' | 'paid';
  gross: string;
  deductions: string;
  net: string;
  paidAt: Date | null;
  paidFrom: 'bank' | 'cash_on_hand' | null;
  paymentReference: string | null;
  receivedAt: Date | null;
  lines: { kind: string; description: string; amount: string }[];
}
