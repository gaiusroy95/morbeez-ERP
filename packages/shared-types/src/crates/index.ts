// Mirrors apps/backend/src/modules/crates/entities/crates.entity.ts (the
// /crates endpoints). Counts are whole crates; money is a decimal string.
import type { IsoDateTime } from '../common';

export type CrateHolderKind = 'yard' | 'customer' | 'farmer' | 'vehicle';
export type CrateMovementKind =
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
export type CrateLossRecovery = 'absorbed' | 'invoiced' | 'deducted';

export interface CrateSettings {
  customerOverdueDays: number;
  farmerOverdueDays: number;
  version: number;
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

export interface CrateHolderRef {
  kind: CrateHolderKind | 'outside' | 'lost';
  id: string | null;
  name: string;
}

export interface CrateHolding {
  holderKind: CrateHolderKind;
  holderId: string | null;
  holderName: string;
  byType: { crateTypeId: string; code: string; balance: number }[];
  total: number;
  value: string;
  oldestSince: string | null;
  daysHeld: number | null;
  limit: number | null;
  lastMovementAt: IsoDateTime | null;
}

export interface CrateMovement {
  id: string;
  batchId: string;
  crateTypeId: string;
  crateCode: string;
  quantity: number;
  kind: CrateMovementKind;
  from: CrateHolderRef;
  to: CrateHolderRef;
  occurredAt: IsoDateTime;
  tripId: string | null;
  tripStopId: string | null;
  reference: string | null;
  notes: string | null;
  reversesMovementId: string | null;
  reversedBy: string | null;
  reversible: boolean;
  createdByEmail: string | null;
}

export interface CrateLoss {
  id: string;
  movementId: string;
  holder: CrateHolderRef;
  crateTypeId: string;
  crateCode: string;
  quantity: number;
  recovery: CrateLossRecovery;
  unitCharge: string;
  amount: string;
  taxAmount: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  reason: string;
  occurredAt: IsoDateTime;
}

export interface CrateHolderDetail extends CrateHolding {
  movements: CrateMovement[];
  losses: CrateLoss[];
}

export interface CrateAlert {
  kind: 'overdue' | 'over_limit' | 'vehicle_idle' | 'yard_low';
  severity: 'bad' | 'attention';
  holderKind: CrateHolderKind;
  holderId: string | null;
  holderName: string;
  crates: number;
  message: string;
}

export interface CrateOverview {
  types: (CrateType & { yard: number; customers: number; farmers: number; vehicles: number; lost: number; owned: number })[];
  alerts: CrateAlert[];
}

export interface CrateParties {
  customers: { id: string; name: string }[];
  farmers: { id: string; name: string }[];
  vehicles: { id: string; name: string }[];
}

export interface TripCrates {
  tripId: string;
  vehicleId: string;
  registrationNumber: string;
  status: string;
  onVehicle: { crateTypeId: string; code: string; balance: number }[];
  loaded: number;
  unloaded: number;
  stops: {
    stopId: string;
    sequenceNumber: number;
    stopType: 'pickup' | 'delivery';
    party: CrateHolderRef;
    dropped: number;
    collected: number;
  }[];
  movements: CrateMovement[];
}
