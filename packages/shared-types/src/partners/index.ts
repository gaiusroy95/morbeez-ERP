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
  /** Village or town. */
  place: string | null;
  /** Default delivery address. */
  address: string | null;
  /** The route they are usually delivered on. */
  routeId: string | null;
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
  /** The spot sales' walk-in buyer, who pays on the spot and never owes. */
  isWalkIn: boolean;
  /** Printed as a QR (MORBEEZ:C:<token>) for the shop; the driver scans it at the door. */
  qrToken: string;
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
  /** Village or town. */
  place: string | null;
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
  place?: string | null;
  address?: string | null;
  routeId?: string | null;
}

export interface UpdateCustomerBody {
  version: number;
  name?: string;
  contact?: ContactDetails;
  preferredLanguage?: AppLanguage;
  place?: string | null;
  address?: string | null;
  routeId?: string | null;
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

// ---- Customers and Farmers lists and profiles (redesign Phase 5) ----

export type CustomersFilter = 'all' | 'active' | 'credit' | 'overdue';

/** Money figures are null for someone without finance:read. */
export interface CustomerCard {
  id: string;
  name: string;
  place: string | null;
  phone: string | null;
  routeId: string | null;
  routeName: string | null;
  status: 'active' | 'archived';
  creditHold: boolean;
  totalSales: string | null;
  outstanding: string | null;
  overdue: string | null;
  oldestOverdueDays: number | null;
  /** 0–5: 5 × the share of invoices paid on time, less a point per 15 days the oldest is overdue. */
  score: number | null;
  creditRisk: boolean | null;
}

export interface CustomersBoard {
  filter: CustomersFilter;
  counts: { all: number; active: number; credit: number | null; overdue: number | null };
  total: number;
  page: number;
  pageSize: number;
  items: CustomerCard[];
}

export interface CustomerProfile {
  customer: CustomerRecord;
  routeName: string | null;
  pin: { latitude: string; longitude: string } | null;
  orders: {
    count: number;
    avgOrderValue: string | null;
    lastOrderAt: IsoDateTime | null;
    recent: { id: string; number: number; day: IsoDate; status: string; total: string }[];
  } | null;
  money: {
    totalSales: string;
    salesLast30Days: string;
    salesPrevious30Days: string;
    outstanding: string;
    overdue: string;
    oldestOverdueDays: number | null;
    onAccount: string;
    openOrderValue: string;
    creditLimit: string;
    available: string;
    settledInvoices: number;
    avgPaymentDays: number | null;
    onTimePct: number | null;
    score: number | null;
    creditRisk: boolean;
    revenue: string;
    costOfGoods: string;
    grossMargin: string;
    grossMarginPct: number | null;
    topProducts: { name: string; uom: string; quantity: string; revenue: string }[];
  } | null;
}

/** GET finance/customers/:id/statement. */
export interface CustomerStatementLine {
  at: IsoDateTime;
  kind: 'invoice' | 'finance_charge' | 'payment' | 'payment_reversal';
  reference: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface CustomerStatement {
  customerId: string;
  customerName: string;
  currency: string;
  from: IsoDate;
  to: IsoDate;
  openingBalance: string;
  closingBalance: string;
  lines: CustomerStatementLine[];
}

export type FarmersFilter = 'all' | 'active' | 'pending';

export interface FarmerCard {
  id: string;
  name: string;
  place: string | null;
  phone: string | null;
  routeName: string | null;
  status: 'active' | 'archived';
  mainProduct: string | null;
  totalPurchases: string | null;
  owed: string | null;
  advance: string | null;
  lastPickupAt: IsoDateTime | null;
}

export interface FarmersBoard {
  filter: FarmersFilter;
  place: string | null;
  counts: { all: number; active: number; pending: number | null };
  places: { place: string; farmers: number }[];
  total: number;
  page: number;
  pageSize: number;
  items: FarmerCard[];
}

export interface FarmerProfile {
  farmer: FarmerRecord;
  routeName: string | null;
  pin: { latitude: string; longitude: string } | null;
  purchases: {
    count: number;
    open: number;
    lastPickupAt: IsoDateTime | null;
    recent: { id: string; number: number; day: IsoDate; status: string; kg: string; value: string }[];
    products: { name: string; uom: string; quantity: string; value: string; avgRate: string | null }[];
  } | null;
  money: {
    totalPurchases: string;
    owed: string;
    paid: string;
    advance: string;
    oldestUnpaidAt: IsoDateTime | null;
    lastPaidAt: IsoDateTime | null;
    payments: { id: string; paidAt: IsoDateTime; amount: string; method: string; reference: string | null }[];
  } | null;
}
