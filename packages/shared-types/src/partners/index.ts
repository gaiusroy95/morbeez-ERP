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
  financeChargeRateMonthly: string; // percent per 30 days on overdue invoices
  financeChargeGraceDays: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  status: 'active' | 'archived';
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

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
  baseUom: 'kg' | 'g' | 'crate' | 'bag' | 'dozen' | 'unit';
  basePrice: string;
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
  version: number;
}

// Request bodies.
export interface CreateCustomerBody {
  name: string;
  contact?: ContactDetails;
  creditLimit?: number;
  paymentTermsDays?: number;
}

export interface UpdateCustomerBody {
  version: number;
  name?: string;
  contact?: ContactDetails;
}

export interface UpdateCreditTermsBody {
  version: number;
  creditLimit?: number;
  paymentTermsDays?: number;
  financeChargeRateMonthly?: number;
  financeChargeGraceDays?: number;
  creditHold?: boolean;
  creditHoldReason?: string;
}
