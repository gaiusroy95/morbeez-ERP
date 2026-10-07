import type { IsoDateTime } from '../common';

// Owner independence (client Q&A 1 Oct 2026, D–E): delegation levels,
// grants, day-off mode, owner alerts and the evening summary.

export type DelegationLevel = 1 | 2 | 3 | 4;
export type DelegationKind = 'trip' | 'day_off' | 'temporary';
export type Capability = 'deliver' | 'collect' | 'deposit' | 'spot_sale' | 'procure' | 'expense';

export interface Authority {
  level: 0 | DelegationLevel;
  source: 'standing' | DelegationKind | null;
  eligibleUpTo: number | null;
  until: IsoDateTime | null;
  can: Record<Capability, boolean>;
}

export interface DelegationRecord {
  id: string;
  driverEmployeeId: string;
  level: DelegationLevel;
  kind: DelegationKind;
  tripId: string | null;
  endsAt: IsoDateTime | null;
  note: string | null;
  grantedBy: string;
  grantedAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  revokedBy: string | null;
}

export interface DelegationListItem extends DelegationRecord {
  driverName: string;
  tripStatus: string | null;
}

export interface DriverPoolEntry {
  employeeId: string;
  name: string;
  hasLogin: boolean;
  isMe: boolean;
  delegationLevel: number | null;
  standingDelegation: boolean;
  busy: boolean;
  tripsClosed: number;
  closedClean: number;
  cashMismatches: number;
  lastTripAt: IsoDateTime | null;
  authority: Authority;
  suggestedIndependent: boolean;
}

export interface DayOffState {
  away: boolean;
  until: IsoDateTime | null;
  operatingDayEnd: string;
  grants: DelegationListItem[];
}

export interface GrantDelegationBody {
  driverEmployeeId: string;
  level: number;
  kind: 'trip' | 'temporary';
  tripId?: string;
  endsAt?: string;
  note?: string;
}

export interface StartDayOffBody {
  driverEmployeeId: string;
  level: number;
  tripIds?: string[];
  note?: string;
}

export type AlertKind =
  | 'cash_mismatch'
  | 'collection_discrepancy'
  | 'inventory_mismatch'
  | 'customer_rejection'
  | 'procurement_issue'
  | 'driver_unable_to_continue'
  | 'trip_blocked'
  | 'operational_problem'
  | 'security';

export interface OwnerAlert {
  id: string;
  kind: AlertKind;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  tripId: string | null;
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
}

export interface EveningSummary {
  date: string;
  trips: { started: number; submitted: number; closed: number; open: number };
  procurement: { lots: number; quantity: { uom: string; quantity: string }[]; cost: string };
  deliveries: { done: number; notDelivered: number; customers: number };
  collections: { total: string; byMethod: { method: string; amount: string }[] };
  spotSales: { count: number; total: string };
  expenses: string;
  bankDeposits: string;
  closures: { trips: number; variance: string; withException: number };
  remaining: { product: string; uom: string; quantity: string }[];
  drivers: { name: string; stopsDone: number; collected: string; expenses: string }[];
  exceptions: OwnerAlert[];
  ownerAway: boolean;
}
