// A lot is sold by the kilo (driver app D0): its kilos sit in one or more
// places (stock.lot_balance — the store, a warehouse, a vehicle) and order
// lines hold or take them (commerce.lot_allocation). 'delivered' is
// terminal: everything in the lot has been sold.
export type LotStatus = 'received_ungraded' | 'available' | 'delivered' | 'rejected';

export interface ProductStockRow {
  productId: string;
  available: string;
  reserved: string;
  physical: string;
  onVehicles: string;
  valueAtCost: string;
  availableLots: number;
  ungradedLots: number;
  ungradedQuantity: string;
  oldestAvailableReceivedAt: Date | null;
}

export interface LotRecord {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  farmerId: string;
  productId: string;
  pickupId: string | null;
  receivedQuantity: string; // numeric as string — Constitution III.2
  acceptedQuantity: string | null;
  rejectedQuantity: string | null;
  grade: string | null;
  rejectionReason: string | null;
  unitCost: string | null;
  status: LotStatus;
  // Set once, at grading, to acceptedQuantity — then the Inventory Engine's
  // running balance: what's left of the lot wherever it is, reduced by
  // sales and write-offs. null until graded, same as acceptedQuantity.
  currentQuantity: string | null;
  /** Kilos of it held for orders. */
  reservedQuantity: string;
  /** Its place when all of it is in one warehouse or vehicle; null in the store or split. */
  currentLocationId: string | null;
  receivedAt: Date;
  gradedAt: Date | null;
  gradedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
