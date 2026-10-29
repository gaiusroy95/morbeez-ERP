import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';

export interface PasswordSetupRow {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
}

/**
 * One-time password set-up links (identity.password_setup). Only a hash of
 * each link's token is stored.
 */
@Injectable()
export class PasswordSetupRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The link is opened by someone not signed in, so the tenant isn't known
   * yet: the SECURITY DEFINER lookup, the same narrow exception as login.
   */
  async findByHash(tokenHash: string): Promise<PasswordSetupRow | null> {
    const r = await this.db.query<PasswordSetupRow>('SELECT * FROM identity.find_password_setup($1)', [tokenHash]);
    return r.rows[0] ?? null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    createdBy: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO identity.password_setup (tenant_id, user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, userId, tokenHash, expiresAt, createdBy],
    );
  }

  /** Locks the link while it's being used, so two submissions can't both use it. */
  async lockWithClient(client: PoolClient, id: string): Promise<PasswordSetupRow | null> {
    const r = await client.query<PasswordSetupRow>(
      'SELECT id, tenant_id, user_id, expires_at, used_at FROM identity.password_setup WHERE id = $1 FOR UPDATE',
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** Uses this link, and retires every other open link for the same person. */
  async useAllForUserWithClient(client: PoolClient, userId: string): Promise<void> {
    await client.query('UPDATE identity.password_setup SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  }
}
