import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { FuelType, VehicleRecord, VehicleStatus } from '../entities/vehicle.entity';

interface VehicleRow {
  id: string;
  tenant_id: string;
  registration_number: string;
  capacity_kg: string;
  fuel_type: FuelType;
  acquisition_cost: string | null;
  acquisition_date: string | null;
  status: VehicleStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: VehicleRow): VehicleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    registrationNumber: row.registration_number,
    capacityKg: row.capacity_kg,
    fuelType: row.fuel_type,
    acquisitionCost: row.acquisition_cost,
    acquisitionDate: row.acquisition_date,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

@Injectable()
export class VehiclesRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<VehicleRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<VehicleRow>(
          `SELECT * FROM trading_partners.vehicle ORDER BY registration_number LIMIT $1 OFFSET $2`,
          [size, offset],
        ),
        client.query<{ count: string }>('SELECT count(*) FROM trading_partners.vehicle'),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<VehicleRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<VehicleRecord | null> {
    const result = await client.query<VehicleRow>(
      'SELECT * FROM trading_partners.vehicle WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      registrationNumber: string;
      capacityKg: number;
      fuelType: string;
      acquisitionCost?: number;
      acquisitionDate?: string;
    },
  ): Promise<VehicleRecord> {
    try {
      const result = await client.query<VehicleRow>(
        `INSERT INTO trading_partners.vehicle
           (tenant_id, registration_number, capacity_kg, fuel_type, acquisition_cost, acquisition_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          fields.registrationNumber,
          fields.capacityKg,
          fields.fuelType,
          fields.acquisitionCost ?? null,
          fields.acquisitionDate ?? null,
          createdBy,
        ],
      );
      return toRecord(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A vehicle with registration number ${fields.registrationNumber} already exists in this tenant`,
        );
      }
      throw err;
    }
  }

  async updateWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: Partial<{
      registrationNumber: string;
      capacityKg: number;
      fuelType: string;
      acquisitionCost: number;
      acquisitionDate: string;
    }>,
  ): Promise<VehicleRecord> {
    let result;
    try {
      result = await client.query<VehicleRow>(
        `UPDATE trading_partners.vehicle SET
           registration_number = COALESCE($3, registration_number),
           capacity_kg = COALESCE($4, capacity_kg),
           fuel_type = COALESCE($5, fuel_type),
           acquisition_cost = COALESCE($6, acquisition_cost),
           acquisition_date = COALESCE($7, acquisition_date),
           version = version + 1,
           updated_at = now()
         WHERE id = $1 AND version = $2
         RETURNING *`,
        [
          id,
          expectedVersion,
          fields.registrationNumber,
          fields.capacityKg,
          fields.fuelType,
          fields.acquisitionCost,
          fields.acquisitionDate,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A vehicle with registration number ${fields.registrationNumber} already exists in this tenant`,
        );
      }
      throw err;
    }
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Vehicle', id);
    }
    return toRecord(result.rows[0]);
  }

  async setStatusWithClient(
    client: PoolClient,
    id: string,
    status: VehicleStatus,
  ): Promise<VehicleRecord | null> {
    const result = await client.query<VehicleRow>(
      `UPDATE trading_partners.vehicle SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
