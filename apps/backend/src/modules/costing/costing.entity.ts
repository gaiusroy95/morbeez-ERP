import type { CostComponent } from './costing-math';

// Master Spec v3 P5 — what Costing answers. Money a 2-dp string, KG a 3-dp
// string, rates per KG and per km 4-dp strings (Constitution III.2).
// Mirrored in packages/shared-types/src/costing.

/** A closed trip's cost (rule C1), where it went (C3) and how it compares (C5). */
export interface TripCostRecord {
  tripId: string;
  tripNumber: string | null;
  source: 'close' | 'backfill';
  computedAt: Date;
  /** The running pool's share by KG used; the rest by verified service minutes (D1). */
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

/** One row of the contribution hierarchy (MS §35–36; rule C6). */
export interface ContributionRow {
  /** null: costs not attributable at this level (unallocated, the inbound leg, store write-offs), or lines not yet costed. */
  key: string | null;
  label: string;
  kg: string;
  revenue: string;
  purchase: string;
  agent: string;
  /** Loading labour, helpers' and the driver's incentives. */
  labour: string;
  fuel: string;
  tolls: string;
  /** The vehicle's share and road repairs. */
  delivery: string;
  /** Shrinkage and rejection: stock written off. */
  writtenOff: string;
  other: string;
  trueCost: string;
  operatingContribution: string;
  financeCost: string;
  netContribution: string;
  revenuePerKg: string | null;
  trueCostPerKg: string | null;
  contributionPerKg: string | null;
  /** Net contribution as a share of revenue, %. */
  netMarginPct: number | null;
}

export interface ContributionReport {
  level: ContributionLevel;
  from: string;
  to: string;
  currency: string;
  costOfCapitalPct: string;
  rows: ContributionRow[];
  totals: ContributionRow;
  /** Sold lines whose trip hadn't been costed (open, or closed before costing and not backfilled). */
  uncostedLines: number;
}

export interface CostAllocationSettings {
  kgSharePct: string;
  history: { kgSharePct: string; effectiveFrom: Date; setBy: string | null; note: string | null }[];
}
