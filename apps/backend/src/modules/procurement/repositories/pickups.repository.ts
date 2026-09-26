import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { PickupRecord, PickupStatus } from '../entities/pickup.entity';

interface PickupRow {
  id: string;
  tenant_id: string;
  purchase_order_id: string;
  farmer_id: string;
  vehicle_id: string | null;
  driver_employee_id: string | null;
  status: PickupStatus;
  scheduled_at: Date | null;
  picked_up_at: Date | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: PickupRow): PickupRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    purchaseOrderId: row.purchase_order_id,
    farmerId: row.farmer_id,
    vehicleId: row.vehicle_id,
    driverEmployeeId: row.driver_employee_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    pickedUpAt: row.picked_up_at,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class PickupsRepository {
  constructor(private readonly db: DatabaseService) {}

  listByPurchaseOrder(tenantId: string, purchaseOrderId: string): Promise<PickupRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<PickupRow>(
        'SELECT * FROM commerce.pickup WHERE purchase_order_id = $1 ORDER BY created_at',
        [purchaseOrderId],
      );
      return result.rows.map(toRecord);
    });
  }

  findById(tenantId: string, id: string): Promise<PickupRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<PickupRecord | null> {
    const result = await client.query<PickupRow>('SELECT * FROM commerce.pickup WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      purchaseOrderId: string;
      farmerId: string;
      vehicleId?: string | null;
      driverEmployeeId?: string | null;
      scheduledAt?: string | null;
    },
  ): Promise<PickupRecord> {
    const result = await client.query<PickupRow>(
      `INSERT INTO commerce.pickup
         (tenant_id, purchase_order_id, farmer_id, vehicle_id, driver_employee_id, scheduled_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        fields.purchaseOrderId,
        fields.farmerId,
        fields.vehicleId ?? null,
        fields.driverEmployeeId ?? null,
        fields.scheduledAt ?? null,
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
  }

  async completeWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: { vehicleId: string; driverEmployeeId: string },
  ): Promise<PickupRecord> {
    const result = await client.query<PickupRow>(
      `UPDATE commerce.pickup SET
         status = 'completed',
         vehicle_id = $3,
         driver_employee_id = $4,
         picked_up_at = now(),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'scheduled'
       RETURNING *`,
      [id, expectedVersion, fields.vehicleId, fields.driverEmployeeId],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Pickup', id);
    return toRecord(result.rows[0]);
  }

  async cancelWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<PickupRecord> {
    const result = await client.query<PickupRow>(
      `UPDATE commerce.pickup SET status = 'cancelled', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'scheduled'
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Pickup', id);
    return toRecord(result.rows[0]);
  }
}
