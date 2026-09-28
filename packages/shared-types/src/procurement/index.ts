// Mirrors apps/backend/src/modules/procurement/entities/*.
import type { IsoDate, IsoDateTime } from '../common';
import type { PaymentMethod } from '../finance';

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
  updatedAt: IsoDateTime;
  lines?: PurchaseOrderLineRecord[]; // detail only
  expectedValue?: string; // list rows only
}

export type LotStatus = 'received_ungraded' | 'available' | 'reserved' | 'delivered' | 'rejected';

export interface LotRecord {
  id: string;
  purchaseOrderId: string;
  farmerId: string;
  productId: string;
  pickupId: string | null;
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
  version: number;
}

export interface PickupRecord {
  id: string;
  purchaseOrderId: string;
  farmerId: string;
  vehicleId: string | null;
  driverEmployeeId: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  scheduledAt: IsoDateTime | null;
  pickedUpAt: IsoDateTime | null;
  notes: string | null;
  version: number;
}

// Request bodies.
export interface CreatePurchaseOrderBody {
  farmerId: string;
  lines: { productId: string; expectedQuantity: number; indicativePrice: number }[];
}

export interface ReceiveGoodsBody {
  lines: { productId: string; receivedQuantity: number }[];
  pickupId?: string;
}

export interface GradeLotBody {
  version: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  grade?: string;
  rejectionReason?: string;
  unitCost?: number;
}

export interface SchedulePickupBody {
  vehicleId?: string;
  driverEmployeeId?: string;
  scheduledAt?: IsoDateTime;
}

export interface SettleLotBody {
  amount: number;
  method: PaymentMethod;
  notes?: string;
}
