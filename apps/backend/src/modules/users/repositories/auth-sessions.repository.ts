import { Injectable } from '@nestjs/common';
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
  family_id?: string;
  rotated_at?: Date | null;
  device_id?: string | null;
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
    familyId: row.family_id as string,
    rotatedAt: row.rotated_at ?? null,
    deviceId: row.device_id ?? null,
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
    'id' | 'tenantId' | 'userId' | 'expiresAt' | 'revokedAt' | 'familyId' | 'rotatedAt'
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
      familyId: row.family_id as string,
      rotatedAt: row.rotated_at ?? null,
    };
  }

  async create(
    tenantId: string,
    userId: string,
    refreshTokenHash: string,
    deviceInfo: string | undefined,
    expiresAt: Date,
    opts: { familyId?: string; deviceId?: string | null } = {},
  ): Promise<AuthSessionRecord> {
    return this.db.withTenant(tenantId, async (c) => {
      const result = await c.query<SessionRow>(
        `INSERT INTO identity.auth_session
           (tenant_id, user_id, refresh_token_hash, device_info, expires_at, family_id, device_id)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, gen_random_uuid()), $7)
         RETURNING *`,
        [tenantId, userId, refreshTokenHash, deviceInfo ?? null, expiresAt, opts.familyId ?? null, opts.deviceId ?? null],
      );
      return toSessionRecord(result.rows[0]);
    });
  }

  /**
   * Exchanges a session for its successor, exactly once, in one
   * transaction: of two requests racing with the same token only one gets
   * a row back, and by the time anyone can see the old session was rotated,
   * its successor already exists (Security Audit SA-04). Returns null if the
   * session was already rotated or revoked.
   */
  async rotate(
    tenantId: string,
    sessionId: string,
    successor: { userId: string; refreshTokenHash: string; deviceInfo: string | undefined; expiresAt: Date },
  ): Promise<{ deviceId: string | null } | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const old = await client.query<{ device_id: string | null; family_id: string }>(
        `UPDATE identity.auth_session SET revoked_at = now(), rotated_at = now()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING device_id, family_id`,
        [sessionId],
      );
      if (!old.rows[0]) return null;
      await client.query(
        `INSERT INTO identity.auth_session
           (tenant_id, user_id, refresh_token_hash, device_info, expires_at, family_id, device_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, successor.userId, successor.refreshTokenHash, successor.deviceInfo ?? null, successor.expiresAt, old.rows[0].family_id, old.rows[0].device_id],
      );
      return { deviceId: old.rows[0].device_id };
    });
  }

  async deviceOf(tenantId: string, sessionId: string): Promise<string | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<{ device_id: string | null }>('SELECT device_id FROM identity.auth_session WHERE id = $1', [sessionId]);
      return result.rows[0]?.device_id ?? null;
    });
  }

  /** Whether any session descended from the same login is still usable. */
  async familyIsLive(tenantId: string, familyId: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<{ live: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM identity.auth_session
                        WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now()) AS live`,
        [familyId],
      );
      return result.rows[0].live;
    });
  }

  /** Every session descended from one login — for a rotated token presented again. */
  async revokeFamily(tenantId: string, familyId: string): Promise<void> {
    await this.db.withTenant(tenantId, (client) =>
      client.query(
        `UPDATE identity.auth_session SET revoked_at = now()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId],
      ),
    );
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
