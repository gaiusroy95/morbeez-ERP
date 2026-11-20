import type { IsoDate, IsoDateTime } from '../common';

// Master Spec v3 P5 — cost allocation and true cost (rules C1–C8). Money a
// 2-dp string, KG a 3-dp string, ₹ per KG and per km 4-dp strings.

export type CostComponent =
  | 'fuel'
  | 'tolls'
  | 'repairs'
  | 'driverIncentives'
  | 'otherExpenses'
  | 'vehicle'
  | 'labour'
  | 'helperIncentives'
  | 'writtenOff';

/** GET /costing/trips/:id — a closed trip's cost, where it went, and how it compares. */
export interface TripCostRecord {
  tripId: string;
  tripNumber: string | null;
  source: 'close' | 'backfill';
  computedAt: IsoDateTime;
  /** The running pool's share by KG; the rest by verified service minutes (D1). */
  kgSharePct: string;
  components: Record<CostComponent, string>;
  runningTotal: string;
  loadTotal: string;
  total: string;
  tripKm: string | null;
  vehicleRatePerKm: string | null;
  deliveredKg: string;
  pickupKg: string;
  deliveryCost: string;
  inboundCost: string;
  unallocated: string;
  unallocatedReason: string | null;
  unweightedLines: number;
  actualPerKg: string | null;
  standardPerKg: string | null;
  standardBasis: 'route' | 'business' | null;
  standardTrips: number;
  /** Actual − standard, ₹ per KG: above zero, the trip cost more than usual. */
  variancePerKg: string | null;
  orderLines: number;
  customers: number;
  lots: number;
  allocations: {
    stopId: string;
    orderLineId: string | null;
    lotId: string | null;
    customerId: string | null;
    customerName: string | null;
    productName: string;
    kg: string;
    serviceMinutes: number | null;
    amount: string;
    components: Record<CostComponent, string>;
  }[];
}

export type ContributionLevel = 'business' | 'route' | 'trip' | 'vehicle' | 'product' | 'customer' | 'order';

/** A row of the contribution hierarchy (MS §35–36). */
export interface ContributionRow {
  /** null: not attributable at this level, or not costed yet. */
  key: string | null;
  label: string;
  kg: string;
  revenue: string;
  purchase: string;
  agent: string;
  labour: string;
  fuel: string;
  tolls: string;
  delivery: string;
  writtenOff: string;
  other: string;
  trueCost: string;
  operatingContribution: string;
  financeCost: string;
  netContribution: string;
  revenuePerKg: string | null;
  trueCostPerKg: string | null;
  contributionPerKg: string | null;
  netMarginPct: number | null;
}

/** GET /costing/contribution?level&from&to */
export interface ContributionReport {
  level: ContributionLevel;
  from: IsoDate;
  to: IsoDate;
  currency: string;
  costOfCapitalPct: string;
  rows: ContributionRow[];
  totals: ContributionRow;
  uncostedLines: number;
}

/** GET/PUT /costing/settings */
export interface CostAllocationSettings {
  kgSharePct: string;
  history: { kgSharePct: string; effectiveFrom: IsoDateTime; setBy: string | null; note: string | null }[];
}
