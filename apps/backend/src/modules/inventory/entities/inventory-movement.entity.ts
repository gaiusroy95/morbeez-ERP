export type MovementType = 'shrinkage' | 'rejected_post_acceptance' | 'transferred';

export interface InventoryMovementRecord {
  id: string;
  tenantId: string;
  lotId: string;
  productId: string;
  movementType: MovementType;
  quantity: string; // numeric as string — Constitution III.2
  reason: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  createdAt: Date;
  createdBy: string;
}

/** available = physical - reserved (Inventory Engine's core formula). */
export interface StockSummary {
  productId: string;
  physical: string;
  reserved: string;
  available: string;
}
