// Crate management: who holds the business's crates, how they moved, what
// was lost and how it was recovered. Counts are whole crates; money is a
// decimal string (Constitution III.2). Mirrored in packages/shared-types/src/crates.

export type HolderKind = 'yard' | 'customer' | 'farmer' | 'vehicle';
export type EdgeKind = 'outside' | 'lost';
export type MovementKind =
  | 'purchased'
  | 'opening'
  | 'issued'
  | 'returned'
  | 'loaded'
  | 'unloaded'
  | 'delivered'
  | 'collected'
  | 'lost'
  | 'correction';
export type LossRecovery = 'absorbed' | 'invoiced' | 'deducted';

export interface CrateSettings {
  customerOverdueDays: number;
  farmerOverdueDays: number;
  version: number; // 0 = defaults in force
}

export interface CrateType {
  id: string;
  code: string;
  name: string;
  capacityKg: string | null;
  replacementCost: string;
  hsnCode: string | null;
  reorderLevel: number;
  isActive: boolean;
  version: number;
}

export interface HolderRef {
  kind: HolderKind | EdgeKind;
  id: string | null;
  name: string;
}

export interface Holding {
  holderKind: HolderKind;
  holderId: string | null; // null for the yard
  holderName: string;
  byType: { crateTypeId: string; code: string; balance: number }[];
  total: number;
  value: string; // at replacement cost
  oldestSince: string | null; // date the longest-held crate went out (FIFO)
  daysHeld: number | null;
  limit: number | null;
  lastMovementAt: Date | null;
}

export interface MovementRecord {
  id: string;
  batchId: string;
  crateTypeId: string;
  crateCode: string;
  quantity: number;
  kind: MovementKind;
  from: HolderRef;
  to: HolderRef;
  occurredAt: Date;
  tripId: string | null;
  tripStopId: string | null;
  reference: string | null;
  notes: string | null;
  reversesMovementId: string | null;
  reversedBy: string | null;
  reversible: boolean; // not a correction, not reversed, no charge or cost attached
  createdByEmail: string | null;
}

export interface LossRecord {
  id: string;
  movementId: string;
  holder: HolderRef;
  crateTypeId: string;
  crateCode: string;
  quantity: number;
  recovery: LossRecovery;
  unitCharge: string;
  amount: string;
  taxAmount: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  reason: string;
  occurredAt: Date;
}

export interface HolderDetail extends Holding {
  movements: MovementRecord[];
  losses: LossRecord[];
}

export type AlertKind = 'overdue' | 'over_limit' | 'vehicle_idle' | 'yard_low';

export interface CrateAlert {
  kind: AlertKind;
  severity: 'bad' | 'attention';
  holderKind: HolderKind;
  holderId: string | null;
  holderName: string;
  crates: number;
  message: string;
}

export interface CrateOverview {
  types: (CrateType & { yard: number; customers: number; farmers: number; vehicles: number; lost: number; owned: number })[];
  alerts: CrateAlert[];
}

export interface TripCrates {
  tripId: string;
  vehicleId: string;
  registrationNumber: string;
  status: string;
  onVehicle: { crateTypeId: string; code: string; balance: number }[]; // the vehicle's balance now
  loaded: number;
  unloaded: number;
  stops: {
    stopId: string;
    sequenceNumber: number;
    stopType: 'pickup' | 'delivery';
    party: HolderRef;
    dropped: number; // left with the party
    collected: number; // taken back from the party
  }[];
  movements: MovementRecord[];
}
