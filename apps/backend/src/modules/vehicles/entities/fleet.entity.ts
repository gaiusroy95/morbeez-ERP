// Vehicle economics: fuel, maintenance, documents, the asset and its
// depreciation, loans, and hired vehicles. Money is a decimal string
// (Constitution III.2). Mirrored in packages/shared-types/src/fleet.

import type { Installment } from '../fleet-math';

export type Ownership = 'owned' | 'hired';
export type PaidFrom = 'bank' | 'cash_on_hand';
export type DocType = 'registration' | 'insurance' | 'puc' | 'fitness' | 'permit' | 'road_tax' | 'other';
export type DocState = 'valid' | 'expiring' | 'expired' | 'no_expiry';
export type MaintenanceKind = 'service' | 'repair' | 'tyres' | 'battery' | 'accident' | 'other';
export type HireBasis = 'per_trip' | 'per_day' | 'per_km' | 'per_month';

export interface FleetSettings {
  documentReminderDays: number;
  blockTripsOnExpired: boolean;
  version: number; // 0 = defaults in force
}

export interface DocumentRecord {
  id: string;
  vehicleId: string;
  docType: DocType;
  docNumber: string | null;
  issuer: string | null;
  validFrom: string | null;
  validUntil: string | null;
  amount: string;
  notes: string | null;
  state: DocState;
  superseded: boolean; // a later one of the same type exists
  createdAt: Date;
}

export interface FuelRecord {
  id: string;
  vehicleId: string;
  filledOn: string;
  litres: string;
  amount: string;
  odometerKm: number | null;
  station: string | null;
  paidFrom: PaidFrom;
  tripId: string | null;
}

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  serviceDate: string;
  kind: MaintenanceKind;
  description: string;
  vendor: string | null;
  odometerKm: number | null;
  amount: string;
  nextDueDate: string | null;
  nextDueKm: number | null;
}

export interface AssetView {
  capitalizedOn: string;
  cost: string;
  salvageValue: string;
  method: 'straight_line' | 'written_down';
  usefulLifeMonths: number | null;
  annualRate: string | null;
  fundedBy: PaidFrom | 'owner_capital';
  accumulated: string;
  netBookValue: string;
  depreciatedThrough: string | null; // last month posted, YYYY-MM-01
  entries: { month: string; amount: string; accumulatedAfter: string }[];
  disposal: {
    disposedOn: string;
    method: 'sold' | 'scrapped' | 'written_off';
    proceeds: string;
    netBookValue: string;
    gainLoss: string;
    buyer: string | null;
  } | null;
}

export interface LoanView {
  id: string;
  vehicleId: string;
  lender: string;
  accountNumber: string | null;
  principal: string;
  annualRate: string;
  tenureMonths: number;
  emi: string;
  disbursedOn: string;
  firstEmiOn: string;
  status: 'active' | 'closed';
  principalRepaid: string;
  interestPaid: string;
  outstanding: string;
  version: number;
  payments: { installmentNo: number; paidOn: string; interest: string; principal: string; paidFrom: PaidFrom; reference: string | null }[];
  schedule: Installment[]; // what's left
  nextDue: Installment | null;
}

export interface HireContract {
  id: string;
  vehicleId: string;
  ownerName: string;
  ownerPan: string | null;
  ownerPhone: string | null;
  rateBasis: HireBasis;
  rate: string;
  includesFuel: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface HireBill {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  contractId: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  quantity: string;
  rate: string;
  amount: string;
  billReference: string | null;
  status: 'unpaid' | 'paid';
  paidOn: string | null;
  paidFrom: PaidFrom | null;
  tdsAmount: string;
  tdsSection: string | null;
  version: number;
}

export interface HireSuggestion {
  contract: HireContract | null;
  rateBasis: HireBasis | null;
  quantity: string | null; // null when it can't be counted (per km)
  basis: string; // how it was counted
  trips: number;
  days: number;
  overlapping: string | null; // an existing bill covering part of the period
}

export interface VehicleOverview {
  vehicleId: string;
  registrationNumber: string;
  status: 'active' | 'maintenance' | 'disposed';
  fuelType: string;
  capacityKg: string;
  ownership: Ownership;
  makeModel: string | null;
  manufactureYear: number | null;
  profileVersion: number;
  fitForTrips: boolean;
  issues: string[]; // why not fit, and what's coming up
  documents: { docType: DocType; validUntil: string | null; state: DocState }[]; // current one per type
  maintenanceDue: { date: string | null; km: number | null; overdue: boolean } | null;
  lastOdometerKm: number | null;
  netBookValue: string | null;
  loanOutstanding: string;
  hireContract: HireContract | null;
  unpaidHire: string;
}

export interface VehicleDetail extends VehicleOverview {
  allDocuments: DocumentRecord[];
  fuel: FuelRecord[];
  maintenance: MaintenanceRecord[];
  asset: AssetView | null;
  loans: LoanView[];
  hireContracts: HireContract[];
  hireBills: HireBill[];
}

export interface EconomicsRow {
  vehicleId: string;
  registrationNumber: string;
  ownership: Ownership;
  trips: number;
  daysUsed: number;
  km: number | null;
  litres: string;
  kmPerLitre: string | null;
  fuel: string; // fuel logs + fuel spent on its trips
  maintenance: string;
  documents: string;
  depreciation: string;
  loanInterest: string;
  hire: string;
  total: string;
  costPerTrip: string | null;
  costPerKm: string | null;
}

export interface EconomicsReport {
  currency: string;
  from: string;
  to: string;
  rows: EconomicsRow[];
  totals: Omit<EconomicsRow, 'vehicleId' | 'registrationNumber' | 'ownership' | 'kmPerLitre' | 'costPerTrip' | 'costPerKm'>;
}
