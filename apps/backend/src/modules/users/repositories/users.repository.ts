import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { UserRecord, UserStatus } from '../entities/user.entity';

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    passwordHash: row.password_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The ONE lookup in this repository that runs without a tenant context
   * — by design, via the SECURITY DEFINER function, because at login the
   * tenant isn't known yet (see the identity-tables migration for why this
   * is safe: a single, named, auditable exception, not a bypass).
   */
  async findByEmailForLogin(email: string): Promise<UserRecord | null> {
    const result = await this.db.query<UserRow>(
      'SELECT * FROM identity.find_user_for_login($1)',
      [email],
    );
    return result.rows[0] ? toUserRecord(result.rows[0]) : null;
  }

  async findById(tenantId: string, id: string): Promise<UserRecord | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<UserRow>(
        'SELECT * FROM identity.app_user WHERE id = $1',
        [id],
      );
      return result.rows[0] ? toUserRecord(result.rows[0]) : null;
    });
  }

  async list(tenantId: string): Promise<UserRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<UserRow>(
        'SELECT * FROM identity.app_user ORDER BY created_at DESC',
      );
      return result.rows.map(toUserRecord);
    });
  }

  async create(
    tenantId: string,
    email: string,
    passwordHash: string,
  ): Promise<UserRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `INSERT INTO identity.app_user (tenant_id, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [tenantId, email, passwordHash],
      );
      return toUserRecord(result.rows[0]);
    });
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: UserStatus,
  ): Promise<UserRecord | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<UserRow>(
        `UPDATE identity.app_user SET status = $1, updated_at = now()
         WHERE id = $2
         RETURNING *`,
        [status, id],
      );
      return result.rows[0] ? toUserRecord(result.rows[0]) : null;
    });
  }

  async updatePasswordHash(
    tenantId: string,
    id: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db.withTenant(tenantId, (client) =>
      client.query(
        `UPDATE identity.app_user SET password_hash = $1, updated_at = now()
         WHERE id = $2`,
        [passwordHash, id],
      ),
    );
  }

  /** For use inside an existing withTenant() transaction — e.g. registration flows that also assign a default role. */
  async createWithClient(
    client: PoolClient,
    tenantId: string,
    email: string,
    passwordHash: string,
  ): Promise<UserRecord> {
    const result = await client.query<UserRow>(
      `INSERT INTO identity.app_user (tenant_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tenantId, email, passwordHash],
    );
    return toUserRecord(result.rows[0]);
  }

  async findRolesAndPermissions(
    tenantId: string,
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    return this.db.withTenant(tenantId, async (client) => {
      const roleResult = await client.query<{ name: string }>(
        `SELECT r.name FROM identity.role r
         JOIN identity.user_role ur ON ur.role_id = r.id
         WHERE ur.user_id = $1`,
        [userId],
      );
      const permissionResult = await client.query<{ code: string }>(
        `SELECT DISTINCT p.code FROM identity.permission p
         JOIN identity.role_permission rp ON rp.permission_id = p.id
         JOIN identity.user_role ur ON ur.role_id = rp.role_id
         WHERE ur.user_id = $1`,
        [userId],
      );
      return {
        roles: roleResult.rows.map((r) => r.name),
        permissions: permissionResult.rows.map((p) => p.code),
      };
    });
  }
}
