export type ProductStatus = 'active' | 'archived';

export const VALID_UOMS = ['kg', 'g', 'crate', 'bag', 'dozen', 'unit', 'piece'] as const;
export type UnitOfMeasure = (typeof VALID_UOMS)[number];

/**
 * How a product is traded (client Q&A, pilot baseline):
 * - standard: vegetables and the like, by its unit of measure;
 * - live_bird: live chicken by net live weight (kg) — farm weighment first,
 *   a customer-end weighment settles the sale when there is one;
 * - egg: counted in pieces, bought and sold by piece or tray (packSize a tray).
 */
export const PRODUCT_KINDS = ['standard', 'live_bird', 'egg'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export interface ProductRecord {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  baseUom: UnitOfMeasure;
  /**
   * An optional reference price, never what an order is priced at: a new
   * order line is suggested the last actual price (client Q&A, pricing).
   * Numeric as string — Constitution III.2.
   */
  basePrice: string | null;
  kind: ProductKind;
  /** Eggs: pieces to a tray. */
  packSize: number | null;
  /** Shrinkage (live birds) or breakage (eggs) the owner accepts, %; null = the business default. */
  lossTolerancePct: string | null;
  status: ProductStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
