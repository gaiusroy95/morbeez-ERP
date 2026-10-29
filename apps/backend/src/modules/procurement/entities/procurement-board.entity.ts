import { PurchaseOrderStatus } from './purchase-order.entity';

export type ProcurementBoardDay = 'today' | 'tomorrow' | 'all';

/** Where an order is, in the owner's words: Pending, In Progress, Completed (+ waiting for approval, cancelled). */
export type ProcurementStage = 'pending' | 'awaiting_approval' | 'in_progress' | 'completed' | 'cancelled';

export interface ProcurementCardProduct {
  name: string;
  /** In the product's unit (kg). */
  quantity: string;
  uom: string;
  bags: string | null;
  kgPerBag: string | null;
}

export interface ProcurementCard {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  stage: ProcurementStage;
  /** The pickup date, or the day it was raised. */
  day: string;
  /** HH:MM, local; null when no time was set. */
  pickupTime: string | null;
  farmerName: string;
  farmerPlace: string | null;
  driverName: string | null;
  vehicle: string | null;
  products: ProcurementCardProduct[];
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

export interface AgentRecord {
  id: string;
  name: string;
  phone: string | null;
  defaultCommissionPerKg: string;
  status: 'active' | 'archived';
}
