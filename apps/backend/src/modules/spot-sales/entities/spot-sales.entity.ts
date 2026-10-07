// Driver spot sales: a sale to a walk-in buyer from the stock on a
// vehicle, paid on the spot. Money is a decimal string (Constitution
// III.2); quantities have 3 decimals. Mirrored in packages/shared-types/src/spot-sales.

import type { BandSource, PriceException } from '../spot-math';

export type SpotSaleStatus = 'pending_approval' | 'completed' | 'rejected' | 'cancelled';
export type SpotPaymentMethod = 'cash' | 'upi';

export interface SpotSettings {
  defaultFloorPct: string; // below the product's base price
  defaultCeilingPct: string; // above it
  version: number; // 0 = defaults in force
}

export interface PriceBand {
  id: string;
  productId: string;
  productName: string;
  minPrice: string;
  maxPrice: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

/** What a vehicle on a trip can sell, and at what prices without approval. */
export interface VehicleStockRow {
  productId: string;
  productName: string;
  uom: string;
  onVehicle: string; // in available lots at the vehicle's location(s)
  held: string; // by spot sales awaiting approval
  sellable: string;
  basePrice: string | null;
  band: { source: BandSource; min: string | null; max: string | null };
}

export interface SpotSaleLine {
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  bandSource: BandSource;
  bandMin: string | null;
  bandMax: string | null;
  unitCostEstimate: string | null;
  exception: PriceException | null;
  exceptionValue: string;
  lots: { lotId: string; quantity: string; unitCost: string }[]; // once completed
}

export interface SpotSaleRecord {
  id: string;
  saleNumber: string;
  clientRef: string;
  tripId: string;
  vehicleId: string;
  registrationNumber: string;
  driverEmployeeId: string;
  driverName: string;
  buyerName: string | null;
  buyerPhone: string | null;
  paymentMethod: SpotPaymentMethod;
  paymentReference: string | null;
  status: SpotSaleStatus;
  subtotal: string;
  exceptionValue: string;
  taxTotal: string | null;
  total: string | null;
  costTotal: string | null;
  margin: string | null;
  approvalRequestId: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'cancelled' | null;
  requestedByEmail: string | null;
  /** Who asked for the price approval — never also the one who decides it. */
  requestedBy: string | null;
  decisionNote: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  soldAt: Date;
  completedAt: Date | null;
  closedReason: string | null;
  version: number;
  lines: SpotSaleLine[];
}

export interface SpotSalesSummary {
  from: string;
  to: string;
  currency: string;
  completed: number;
  pending: number;
  revenue: string; // before GST
  tax: string;
  cost: string;
  margin: string;
  cash: string;
  upi: string;
  exceptionsApproved: number;
}
