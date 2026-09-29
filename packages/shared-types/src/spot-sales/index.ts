// Mirrors apps/backend/src/modules/spot-sales/entities/spot-sales.entity.ts
// (the /spot-sales endpoints). Money and quantities are decimal strings.
import type { IsoDate, IsoDateTime } from '../common';

export type SpotSaleStatus = 'pending_approval' | 'completed' | 'rejected' | 'cancelled';
export type SpotPaymentMethod = 'cash' | 'upi';
export type SpotBandSource = 'band' | 'default' | 'none';
export type SpotPriceException = 'below_band' | 'above_band' | 'no_band' | 'below_cost';

export interface SpotSettings {
  defaultFloorPct: string;
  defaultCeilingPct: string;
  version: number;
}

export interface SpotPriceBand {
  id: string;
  productId: string;
  productName: string;
  minPrice: string;
  maxPrice: string | null;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  notes: string | null;
}

export interface SpotVehicleStockRow {
  productId: string;
  productName: string;
  uom: string;
  onVehicle: string;
  held: string;
  sellable: string;
  basePrice: string | null;
  band: { source: SpotBandSource; min: string | null; max: string | null };
}

export interface SpotSaleLine {
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  bandSource: SpotBandSource;
  bandMin: string | null;
  bandMax: string | null;
  unitCostEstimate: string | null;
  exception: SpotPriceException | null;
  exceptionValue: string;
  lots: { lotId: string; quantity: string; unitCost: string }[];
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
  decisionNote: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  soldAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  closedReason: string | null;
  version: number;
  lines: SpotSaleLine[];
}

export interface SpotSalesSummary {
  from: IsoDate;
  to: IsoDate;
  currency: string;
  completed: number;
  pending: number;
  revenue: string;
  tax: string;
  cost: string;
  margin: string;
  cash: string;
  upi: string;
  exceptionsApproved: number;
}
