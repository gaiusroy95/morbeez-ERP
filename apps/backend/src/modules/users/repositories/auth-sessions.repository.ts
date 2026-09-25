import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { AuthSessionRecord } from '../entities/auth-session.entity';

interface SessionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  refresh_token_hash?: string;
  device_info: string | null;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function toSessionRecord(row: SessionRow): AuthSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash ?? '',
    deviceInfo: row.device_info,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

@Injectable()
export class AuthSessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The refresh-token counterpart to UsersRepository.findByEmailForLogin —
   * the tenant isn't known until the session is found, so this is the
   * second (and last) sanctioned use of the untenanted SECURITY DEFINER
   * path. Everything after this call runs inside withTenant() as normal.
   */
  async findByRefreshTokenHash(hash: string): Promise<Pick<
    AuthSessionRecord,
    'id' | 'tenantId' | 'userId' | 'expiresAt' | 'revokedAt'
  > | null> {
    const result = await this.db.query<SessionRow>(
      'SELECT * FROM identity.find_session_by_token_hash($1)',
      [hash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async create(
    tenantId: string,
    userId: string,
    refreshTokenHash: string,
    deviceInfo: string | undefined,
    expiresAt: Date,
    client?: PoolClient,
  ): Promise<AuthSessionRecord> {
    const run = async (c: PoolClient) => {
      const result = await c.query<SessionRow>(
        `INSERT INTO identity.auth_session
           (tenant_id, user_id, refresh_token_hash, device_info, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tenantId, userId, refreshTokenHash, deviceInfo ?? null, expiresAt],
      );
      return toSessionRecord(result.rows[0]);
    };
    return client ? run(client) : this.db.withTenant(tenantId, run);
  }

  async revoke(tenantId: string, sessionId: string): Promise<void> {
    await this.db.withTenant(tenantId, (client) =>
      client.query(
        `UPDATE identity.auth_session SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [sessionId],
      ),
    );
  }

  /** "Log out everywhere" — used on password change (Constitution V.7). */
  async revokeAllForUser(tenantId: string, userId: string): Promise<void> {
    await this.db.withTenant(tenantId, (client) =>
      client.query(
        `UPDATE identity.auth_session SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      ),
    );
  }
}
