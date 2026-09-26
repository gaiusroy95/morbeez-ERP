import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { LocationRecord, LocationStatus, LocationType } from '../entities/location.entity';

interface LocationRow {
  id: string;
  tenant_id: string;
  name: string;
  type: LocationType;
  vehicle_id: string | null;
  status: LocationStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: LocationRow): LocationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.type,
    vehicleId: row.vehicle_id,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class LocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<LocationRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<LocationRow>(`SELECT * FROM stock.location ORDER BY name LIMIT $1 OFFSET $2`, [size, offset]),
        client.query<{ count: string }>('SELECT count(*) FROM stock.location'),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<LocationRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<LocationRecord | null> {
    const result = await client.query<LocationRow>('SELECT * FROM stock.location WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: { name: string; type: LocationType; vehicleId: string | null },
  ): Promise<LocationRecord> {
    const result = await client.query<LocationRow>(
      `INSERT INTO stock.location (tenant_id, name, type, vehicle_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, fields.name, fields.type, fields.vehicleId, createdBy],
    );
    return toRecord(result.rows[0]);
  }

  async updateWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: { name?: string },
  ): Promise<LocationRecord> {
    const result = await client.query<LocationRow>(
      `UPDATE stock.location SET
         name = COALESCE($3, name),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [id, expectedVersion, fields.name ?? null],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Location', id);
    return toRecord(result.rows[0]);
  }

  async setStatusWithClient(client: PoolClient, id: string, status: LocationStatus): Promise<LocationRecord | null> {
    const result = await client.query<LocationRow>(
      `UPDATE stock.location SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
