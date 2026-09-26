// Mirrors apps/backend/src/modules/procurement/entities/*.
import type { IsoDate, IsoDateTime } from '../common';

export type PurchaseOrderStatus = 'placed' | 'confirmed' | 'cancelled' | 'received' | 'graded' | 'closed';

export interface PurchaseOrderLineRecord {
  id: string;
  purchaseOrderId: string;
  productId: string;
  expectedQuantity: string;
  indicativePrice: string;
}

export interface PurchaseOrderRecord {
  id: string;
  farmerId: string;
  status: PurchaseOrderStatus;
  expectedDeliveryDate: IsoDate | null;
  approvalRequestId: string | null;
  version: number;
  createdAt: IsoDateTime;
  lines?: PurchaseOrderLineRecord[]; // detail only
  expectedValue?: string; // list rows only
}

export type LotStatus = 'received_ungraded' | 'available' | 'reserved' | 'delivered' | 'rejected';

export interface LotRecord {
  id: string;
  purchaseOrderId: string;
  farmerId: string;
  productId: string;
  receivedQuantity: string;
  acceptedQuantity: string | null;
  rejectedQuantity: string | null;
  grade: string | null;
  rejectionReason: string | null;
  unitCost: string | null;
  status: LotStatus;
  reservedForOrderLineId: string | null;
  currentQuantity: string | null;
  currentLocationId: string | null;
  receivedAt: IsoDateTime;
  gradedAt: IsoDateTime | null;
}

export interface PickupRecord {
  id: string;
  purchaseOrderId: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  scheduledAt: IsoDateTime | null;
  pickedUpAt: IsoDateTime | null;
  notes: string | null;
}

export interface FarmerSettlementRecord {
  id: string;
  lotId: string;
  farmerId: string;
  amount: string;
  method: 'cash' | 'bank_transfer' | 'upi' | 'cheque';
  settledAt: IsoDateTime;
}
