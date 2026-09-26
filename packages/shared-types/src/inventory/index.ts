// Mirrors ProductStockRow in apps/backend/src/modules/procurement/entities/lot.entity.ts
// (GET /inventory/stock).
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
