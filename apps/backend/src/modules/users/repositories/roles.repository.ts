import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { RoleRecord } from '../entities/role.entity';

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

function toRoleRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class RolesRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(tenantId: string): Promise<RoleRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<RoleRow>(
        'SELECT * FROM identity.role ORDER BY name',
      );
      return result.rows.map(toRoleRecord);
    });
  }

  async findByName(tenantId: string, name: string): Promise<RoleRecord | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<RoleRow>(
        'SELECT * FROM identity.role WHERE name = $1',
        [name],
      );
      return result.rows[0] ? toRoleRecord(result.rows[0]) : null;
    });
  }

  create(tenantId: string, name: string): Promise<RoleRecord> {
    return this.db.withTenant(tenantId, (client) =>
      this.createWithClient(client, tenantId, name),
    );
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    name: string,
  ): Promise<RoleRecord> {
    const result = await client.query<RoleRow>(
      `INSERT INTO identity.role (tenant_id, name) VALUES ($1, $2) RETURNING *`,
      [tenantId, name],
    );
    return toRoleRecord(result.rows[0]);
  }

  /** All permission codes in the global catalog — used to grant a brand-new "Owner" role everything that currently exists. */
  async listAllPermissionCodesWithClient(client: PoolClient): Promise<string[]> {
    const result = await client.query<{ code: string }>(
      'SELECT code FROM identity.permission',
    );
    return result.rows.map((r) => r.code);
  }

  /** The role ids a user directly holds (identity.user_role) — not counting any role granted only via a delegation (approvals.approval_delegation is a different module's concern). */
  async getRoleIdsForUserWithClient(client: PoolClient, userId: string): Promise<string[]> {
    const result = await client.query<{ role_id: string }>(
      'SELECT role_id FROM identity.user_role WHERE user_id = $1',
      [userId],
    );
    return result.rows.map((r) => r.role_id);
  }

  /**
   * Assigns a permission code to a role. The existence check below is not
   * just validation — it's the actual authorization boundary: it runs
   * inside a tenant-scoped transaction, so RLS on identity.role means a
   * role_id from a different tenant simply won't be found, and the
   * assignment fails before ever reaching role_permission (which has no
   * RLS of its own to fall back on).
   */
  assignPermission(tenantId: string, roleId: string, permissionCode: string): Promise<void> {
    return this.db.withTenant(tenantId, (client) =>
      this.assignPermissionWithClient(client, roleId, permissionCode),
    );
  }

  async assignPermissionWithClient(
    client: PoolClient,
    roleId: string,
    permissionCode: string,
  ): Promise<void> {
    const role = await client.query('SELECT 1 FROM identity.role WHERE id = $1', [roleId]);
    if (role.rowCount === 0) {
      throw new NotFoundException(`Role ${roleId} not found in this tenant`);
    }

    const permission = await client.query<{ id: string }>(
      'SELECT id FROM identity.permission WHERE code = $1',
      [permissionCode],
    );
    if (permission.rowCount === 0) {
      throw new NotFoundException(`Permission ${permissionCode} does not exist`);
    }

    await client.query(
      `INSERT INTO identity.role_permission (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [roleId, permission.rows[0].id],
    );
  }

  /** Same authorization-by-RLS pattern as assignPermission — see its comment. */
  assignToUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    return this.db.withTenant(tenantId, (client) =>
      this.assignToUserWithClient(client, userId, roleId),
    );
  }

  async assignToUserWithClient(
    client: PoolClient,
    userId: string,
    roleId: string,
  ): Promise<void> {
    const user = await client.query('SELECT 1 FROM identity.app_user WHERE id = $1', [
      userId,
    ]);
    if (user.rowCount === 0) {
      throw new NotFoundException(`User ${userId} not found in this tenant`);
    }

    const role = await client.query('SELECT 1 FROM identity.role WHERE id = $1', [roleId]);
    if (role.rowCount === 0) {
      throw new NotFoundException(`Role ${roleId} not found in this tenant`);
    }

    await client.query(
      `INSERT INTO identity.user_role (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, roleId],
    );
  }
}
