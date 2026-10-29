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
  /** Entered by the bag: expectedQuantity = bags × kgPerBag. */
  bags: string | null;
  kgPerBag: string | null;
}

export interface PurchaseOrderRecord {
  id: string;
  farmerId: string;
  /** Shown as P-00123 (formatPoNumber). */
  number: number;
  status: PurchaseOrderStatus;
  pickupDate: IsoDate | null;
  pickupTime: string | null;
  plannedDriverId: string | null;
  plannedVehicleId: string | null;
  agentId: string | null;
  commissionPerKg: string | null;
  notes: string | null;
  expectedDeliveryDate: IsoDate | null;
  approvalRequestId: string | null;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lines?: PurchaseOrderLineRecord[]; // detail only
  expectedValue?: string; // list rows only
}

export type LotStatus = 'received_ungraded' | 'available' | 'delivered' | 'rejected';

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
  currentQuantity: string | null;
  /** Kilos of it held for orders. */
  reservedQuantity: string;
  /** Its place when all of it is in one warehouse or vehicle; null in the store or split. */
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
  lines: { productId: string; expectedQuantity: number; indicativePrice: number; bags?: number; kgPerBag?: number }[];
  pickupDate?: IsoDate;
  pickupTime?: string;
  driverEmployeeId?: string;
  vehicleId?: string;
  agentId?: string;
  commissionPerKg?: number;
  notes?: string;
  /** Confirm straight away and schedule the pickup ("Save Procurement"). */
  confirm?: boolean;
}

// ---- The owner's Procurement list (redesign V1.1) ----

export type ProcurementBoardDay = 'today' | 'tomorrow' | 'all';
export type ProcurementStage = 'pending' | 'awaiting_approval' | 'in_progress' | 'completed' | 'cancelled';

export interface ProcurementCard {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  stage: ProcurementStage;
  day: IsoDate;
  pickupTime: string | null;
  farmerName: string;
  farmerPlace: string | null;
  driverName: string | null;
  vehicle: string | null;
  products: { name: string; quantity: string; uom: string; bags: string | null; kgPerBag: string | null }[];
  expectedValue: string;
}

export interface ProcurementBoard {
  day: ProcurementBoardDay;
  counts: { today: number; tomorrow: number; all: number };
  total: number;
  page: number;
  pageSize: number;
  items: ProcurementCard[];
}

/** A middleman who brings produce for a commission. */
export interface AgentRecord {
  id: string;
  name: string;
  phone: string | null;
  defaultCommissionPerKg: string;
  status: 'active' | 'archived';
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
