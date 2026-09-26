export type LocationType = 'warehouse' | 'vehicle' | 'other';
export type LocationStatus = 'active' | 'archived';

export interface LocationRecord {
  id: string;
  tenantId: string;
  name: string;
  type: LocationType;
  vehicleId: string | null;
  status: LocationStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
