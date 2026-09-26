import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { EmployeeRecord, EmployeeRoleType, EmploymentTerms } from '../entities/employee.entity';

interface EmployeeRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  role_type: EmployeeRoleType;
  employment_terms: EmploymentTerms;
  status: 'active' | 'archived';
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: EmployeeRow): EmployeeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    roleType: row.role_type,
    employmentTerms: row.employment_terms ?? {},
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class EmployeesRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<EmployeeRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<EmployeeRow>(
          `SELECT * FROM trading_partners.employee ORDER BY name LIMIT $1 OFFSET $2`,
          [size, offset],
        ),
        client.query<{ count: string }>('SELECT count(*) FROM trading_partners.employee'),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<EmployeeRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<EmployeeRecord | null> {
    const result = await client.query<EmployeeRow>(
      'SELECT * FROM trading_partners.employee WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** Reverse lookup for Logistics' trip-ownership check — userId is nullable on this table, so this can legitimately return null. */
  findByUserId(tenantId: string, userId: string): Promise<EmployeeRecord | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<EmployeeRow>(
        'SELECT * FROM trading_partners.employee WHERE user_id = $1',
        [userId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    });
  }

  /**
   * The existence check IS the authorization boundary, same pattern as
   * RolesRepository.assignToUserWithClient — it runs inside the caller's
   * tenant-scoped transaction, so RLS on identity.app_user means a
   * userId from a different tenant simply won't be found.
   */
  private async assertUserBelongsToTenant(client: PoolClient, userId: string): Promise<void> {
    const result = await client.query('SELECT 1 FROM identity.app_user WHERE id = $1', [userId]);
    if (result.rowCount === 0) {
      throw new NotFoundException(`User ${userId} not found in this tenant`);
    }
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      name: string;
      roleType: string;
      userId?: string;
      employmentTerms: EmploymentTerms;
    },
  ): Promise<EmployeeRecord> {
    if (fields.userId) {
      await this.assertUserBelongsToTenant(client, fields.userId);
    }
    const result = await client.query<EmployeeRow>(
      `INSERT INTO trading_partners.employee
         (tenant_id, user_id, name, role_type, employment_terms, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        fields.userId ?? null,
        fields.name,
        fields.roleType,
        JSON.stringify(fields.employmentTerms),
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
  }

  async updateWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: Partial<{ name: string; roleType: string; employmentTerms: EmploymentTerms }>,
  ): Promise<EmployeeRecord> {
    const result = await client.query<EmployeeRow>(
      `UPDATE trading_partners.employee SET
         name = COALESCE($3, name),
         role_type = COALESCE($4, role_type),
         employment_terms = COALESCE($5, employment_terms),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.name,
        fields.roleType,
        fields.employmentTerms ? JSON.stringify(fields.employmentTerms) : null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('Employee', id);
    }
    return toRecord(result.rows[0]);
  }

  async setStatusWithClient(
    client: PoolClient,
    id: string,
    status: 'active' | 'archived',
  ): Promise<EmployeeRecord | null> {
    const result = await client.query<EmployeeRow>(
      `UPDATE trading_partners.employee SET status = $2, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
