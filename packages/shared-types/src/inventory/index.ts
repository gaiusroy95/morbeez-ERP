// Mirrors ProductStockRow in apps/backend/src/modules/procurement/entities/lot.entity.ts
// (GET /inventory/stock) and apps/backend/src/modules/inventory/entities/*.
import type { IsoDateTime } from '../common';

export interface ProductStockRow {
  productId: string;
  available: string;
  reserved: string;
  physical: string;
  valueAtCost: string;
  availableLots: number;
  ungradedLots: number;
  ungradedQuantity: string;
  oldestAvailableReceivedAt: IsoDateTime | null;
}

export interface LocationRecord {
  id: string;
  name: string;
  type: 'warehouse' | 'vehicle' | 'other';
  vehicleId: string | null;
  status: 'active' | 'archived';
  version: number;
}

export type MovementType = 'shrinkage' | 'rejected_post_acceptance' | 'transferred';

export interface InventoryMovementRecord {
  id: string;
  lotId: string;
  productId: string;
  movementType: MovementType;
  quantity: string;
  reason: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  createdAt: IsoDateTime;
}
