// Master data — the fields the owner app reads, mirroring the backend's
// customers/farmers/products/vehicles/workforce entities. `version` is the
// optimistic-concurrency token every update sends back.
import type { IsoDate, IsoDateTime } from '../common';

export interface ContactDetails {
  phone?: string;
  email?: string;
  notes?: string;
}

export interface CustomerRecord {
  id: string;
  name: string;
  contact: ContactDetails;
  creditLimit: string;
  paymentTermsDays: number;
  // Credit terms beyond limit and days; changed only through
  // POST /customers/:id/credit-terms (customers:credit).
  financeChargeRateMonthly: string; // superseded by financeChargeRateAnnual
  /** Percent a year on overdue invoices, charged per day (÷ 365). */
  financeChargeRateAnnual: string;
  financeChargeGraceDays: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  /** Language for their statements and messages. Tax invoices stay in English. */
  preferredLanguage: AppLanguage;
  status: 'active' | 'archived';
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** English, Malayalam, Kannada, Tamil. */
export type AppLanguage = 'en' | 'ml' | 'kn' | 'ta';

export interface FarmerRecord {
  id: string;
  name: string;
  contact: ContactDetails;
  reliabilityRating: string | null;
  status: 'active' | 'archived';
  version: number;
  createdAt: IsoDateTime;
}

export interface ProductRecord {
  id: string;
  name: string;
  category: string | null;
  baseUom: 'kg' | 'g' | 'crate' | 'bag' | 'dozen' | 'unit' | 'piece';
  /** An optional reference only — orders are priced from the last actual price. */
  basePrice: string | null;
  /** live_bird: by kg of live weight; egg: by piece or tray. */
  kind: 'standard' | 'live_bird' | 'egg';
  /** Eggs: pieces to a tray. */
  packSize: number | null;
  /** Shrinkage (live birds) or breakage (eggs) accepted, %; null = the business default. */
  lossTolerancePct: string | null;
  status: 'active' | 'archived';
  version: number;
}

export interface VehicleRecord {
  id: string;
  registrationNumber: string;
  capacityKg: string;
  fuelType: 'diesel' | 'petrol' | 'cng' | 'electric';
  acquisitionCost: string | null;
  acquisitionDate: IsoDate | null;
  status: 'active' | 'maintenance' | 'disposed';
  version: number;
}

export interface EmployeeRecord {
  id: string;
  userId: string | null;
  name: string;
  roleType: 'driver' | 'warehouse' | 'procurement' | 'finance' | 'other';
  status: 'active' | 'archived';
  /** Highest delegation level the owner allows (1–4); null: not eligible. */
  delegationLevel: number | null;
  /** Authorized at that level on every trip, with no per-trip approval. */
  standingDelegation: boolean;
  version: number;
}

// Request bodies.
export interface CreateCustomerBody {
  name: string;
  contact?: ContactDetails;
  creditLimit?: number;
  paymentTermsDays?: number;
  preferredLanguage?: AppLanguage;
}

export interface UpdateCustomerBody {
  version: number;
  name?: string;
  contact?: ContactDetails;
  preferredLanguage?: AppLanguage;
}

export interface UpdateCreditTermsBody {
  version: number;
  creditLimit?: number;
  paymentTermsDays?: number;
  financeChargeRateMonthly?: number;
  financeChargeRateAnnual?: number;
  financeChargeGraceDays?: number;
  creditHold?: boolean;
  creditHoldReason?: string;
}
