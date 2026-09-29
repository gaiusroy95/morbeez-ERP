// Mirrors apps/backend/src/modules/vehicles/entities/fleet.entity.ts (the
// /fleet endpoints). Money and quantities are decimal strings.
import type { IsoDateTime } from '../common';

export type VehicleOwnership = 'owned' | 'hired';
export type FleetPaidFrom = 'bank' | 'cash_on_hand';
export type VehicleDocType = 'registration' | 'insurance' | 'puc' | 'fitness' | 'permit' | 'road_tax' | 'other';
export type VehicleDocState = 'valid' | 'expiring' | 'expired' | 'no_expiry';
export type MaintenanceKind = 'service' | 'repair' | 'tyres' | 'battery' | 'accident' | 'other';
export type HireBasis = 'per_trip' | 'per_day' | 'per_km' | 'per_month';
export type DepreciationMethod = 'straight_line' | 'written_down';
export type DisposalMethod = 'sold' | 'scrapped' | 'written_off';

export interface FleetSettings {
  documentReminderDays: number;
  blockTripsOnExpired: boolean;
  version: number; // 0 = defaults in force
}

export interface VehicleDocumentRecord {
  id: string;
  vehicleId: string;
  docType: VehicleDocType;
  docNumber: string | null;
  issuer: string | null;
  validFrom: string | null;
  validUntil: string | null;
  amount: string;
  notes: string | null;
  state: VehicleDocState;
  superseded: boolean;
  createdAt: IsoDateTime;
}

export interface FuelRecord {
  id: string;
  vehicleId: string;
  filledOn: string;
  litres: string;
  amount: string;
  odometerKm: number | null;
  station: string | null;
  paidFrom: FleetPaidFrom;
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

export interface VehicleAsset {
  capitalizedOn: string;
  cost: string;
  salvageValue: string;
  method: DepreciationMethod;
  usefulLifeMonths: number | null;
  annualRate: string | null;
  fundedBy: FleetPaidFrom | 'owner_capital';
  accumulated: string;
  netBookValue: string;
  depreciatedThrough: string | null; // YYYY-MM-01
  entries: { month: string; amount: string; accumulatedAfter: string }[];
  disposal: { disposedOn: string; method: DisposalMethod; proceeds: string; netBookValue: string; gainLoss: string; buyer: string | null } | null;
}

export interface AssetRow {
  vehicleId: string;
  registrationNumber: string;
  capitalizedOn: string;
  cost: string;
  method: DepreciationMethod;
  accumulated: string;
  netBookValue: string;
  depreciatedThrough: string | null;
  disposedOn: string | null;
}

export interface LoanInstallment {
  installmentNo: number;
  dueOn: string;
  interest: string;
  principal: string;
  payment: string;
  outstandingAfter: string;
}

export interface VehicleLoan {
  id: string;
  vehicleId: string;
  registrationNumber?: string;
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
  payments: { installmentNo: number; paidOn: string; interest: string; principal: string; paidFrom: FleetPaidFrom; reference: string | null }[];
  schedule: LoanInstallment[];
  nextDue: LoanInstallment | null;
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
  paidFrom: FleetPaidFrom | null;
  tdsAmount: string;
  tdsSection: string | null;
  version: number;
}

export interface HireSuggestion {
  contract: HireContract | null;
  rateBasis: HireBasis | null;
  quantity: string | null;
  basis: string;
  trips: number;
  days: number;
  overlapping: string | null;
}

export interface VehicleOverview {
  vehicleId: string;
  registrationNumber: string;
  status: 'active' | 'maintenance' | 'disposed';
  fuelType: string;
  capacityKg: string;
  ownership: VehicleOwnership;
  makeModel: string | null;
  manufactureYear: number | null;
  profileVersion: number;
  fitForTrips: boolean;
  issues: string[];
  documents: { docType: VehicleDocType; validUntil: string | null; state: VehicleDocState }[];
  maintenanceDue: { date: string | null; km: number | null; overdue: boolean } | null;
  lastOdometerKm: number | null;
  netBookValue: string | null;
  loanOutstanding: string;
  hireContract: HireContract | null;
  unpaidHire: string;
}

export interface VehicleDetail extends VehicleOverview {
  allDocuments: VehicleDocumentRecord[];
  fuel: FuelRecord[];
  maintenance: MaintenanceRecord[];
  asset: VehicleAsset | null;
  loans: VehicleLoan[];
  hireContracts: HireContract[];
  hireBills: HireBill[];
}

export interface VehicleEconomicsRow {
  vehicleId: string;
  registrationNumber: string;
  ownership: VehicleOwnership;
  trips: number;
  daysUsed: number;
  km: number | null;
  litres: string;
  kmPerLitre: string | null;
  fuel: string;
  maintenance: string;
  documents: string;
  depreciation: string;
  loanInterest: string;
  hire: string;
  total: string;
  costPerTrip: string | null;
  costPerKm: string | null;
}

export interface VehicleEconomicsReport {
  currency: string;
  from: string;
  to: string;
  rows: VehicleEconomicsRow[];
  totals: Omit<VehicleEconomicsRow, 'vehicleId' | 'registrationNumber' | 'ownership' | 'kmPerLitre' | 'costPerTrip' | 'costPerKm'>;
}

export interface DepreciationRunResult {
  months: { month: string; total: string; vehicles: number }[];
}
