export type ProductStatus = 'active' | 'archived';

export const VALID_UOMS = ['kg', 'g', 'crate', 'bag', 'dozen', 'unit'] as const;
export type UnitOfMeasure = (typeof VALID_UOMS)[number];

export interface ProductRecord {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  baseUom: UnitOfMeasure;
  basePrice: string; // numeric as string — Constitution III.2
  status: ProductStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
