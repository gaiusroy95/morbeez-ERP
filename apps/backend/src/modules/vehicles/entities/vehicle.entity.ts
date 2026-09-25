export const VALID_FUEL_TYPES = ['diesel', 'petrol', 'cng', 'electric'] as const;
export type FuelType = (typeof VALID_FUEL_TYPES)[number];

// Not the same status set as customer/farmer/product's active|archived —
// a vehicle passes through a genuinely different lifecycle (Accounting
// Engine's disposal accounting is a separate, later concern; this table
// only tracks operational status).
export const VALID_VEHICLE_STATUSES = ['active', 'maintenance', 'disposed'] as const;
export type VehicleStatus = (typeof VALID_VEHICLE_STATUSES)[number];

export interface VehicleRecord {
  id: string;
  tenantId: string;
  registrationNumber: string;
  capacityKg: string; // numeric as string — Constitution III.2
  fuelType: FuelType;
  acquisitionCost: string | null;
  acquisitionDate: string | null; // date as ISO string
  status: VehicleStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
