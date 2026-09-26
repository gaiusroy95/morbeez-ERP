export type PickupStatus = 'scheduled' | 'completed' | 'cancelled';

export interface PickupRecord {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  farmerId: string;
  vehicleId: string | null;
  driverEmployeeId: string | null;
  status: PickupStatus;
  scheduledAt: Date | null;
  pickedUpAt: Date | null;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
