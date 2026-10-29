// Mirrors ProductStockRow in apps/backend/src/modules/procurement/entities/lot.entity.ts
// (GET /inventory/stock) and apps/backend/src/modules/inventory/entities/*.
import type { IsoDateTime } from '../common';

export interface ProductStockRow {
  productId: string;
  available: string;
  reserved: string;
  physical: string;
  /** Of physical, what's out on vehicles. */
  onVehicles: string;
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

/** GET /inventory/vehicles — the owner's Vehicle Stock (redesign V1.1, screen 13). */
export interface VehicleBoardProduct {
  productId: string;
  product: string;
  uom: string;
  onVehicle: string;
  /** Held for the vehicle's deliveries: reserved aboard or still to deliver, whichever is more — never more than is aboard. */
  committed: string;
  free: string;
  toDeliver: string;
}

export interface VehicleBoardCard {
  vehicleId: string;
  registrationNumber: string;
  status: 'in_transit' | 'available';
  tripId: string | null;
  tripNumber: string | null;
  driverName: string | null;
  totalKg: string;
  products: VehicleBoardProduct[];
}

export interface VehicleBoard {
  vehicles: VehicleBoardCard[];
  totalsKg: { onVehicles: string; committed: string; free: string };
}
