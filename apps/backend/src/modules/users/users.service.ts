import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { UsersRepository } from './repositories/users.repository';
import { RolesRepository } from './repositories/roles.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { PasswordSetupRepository } from './repositories/password-setup.repository';
import { PasswordService } from './security/password.service';
import { LoginIdentity, PublicUser, toPublicUser } from './entities/user.entity';

/** How long a password set-up link works. */
export const PASSWORD_SETUP_DAYS = 7;

/** What a staff role may do. Drivers: their own trips, and spot sales from them (Driver App Architecture DRV.17). */
export const STAFF_ROLES = {
  Driver: ['logistics:read', 'logistics:write', 'inventory:write', 'spot_sales:record'],
} as const;
export type StaffRoleName = keyof typeof STAFF_ROLES;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** What the set-up page shows before the password is chosen. */
export interface PasswordSetupInfo {
  state: 'valid' | 'used' | 'expired';
  business: string;
  name: string | null;
  /** The login they'll sign in with, partly hidden: +91 98•••••345. */
  login: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly setups: PasswordSetupRepository,
    private readonly password: PasswordService,
  ) {}

  /**
   * A login for a staff member, created by the owner (client feedback, Oct
   * 2026). It has no usable password: a random one nobody knows, until the
   * person opens their set-up link and chooses their own. Runs inside the
   * caller's transaction (Workforce links it to the employee record there).
   */
  async provisionStaffLoginWithClient(
    client: PoolClient,
    tenantId: string,
    phone: string,
    roleName: StaffRoleName,
  ): Promise<PublicUser> {
    const passwordHash = await this.password.hash(randomBytes(32).toString('hex'));
    let user;
    try {
      // A savepoint, so a taken number can be reported without aborting the caller's transaction.
      await client.query('SAVEPOINT staff_login');
      user = await this.users.createWithClient(client, tenantId, { phone, email: null }, passwordHash);
      await client.query('RELEASE SAVEPOINT staff_login');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT staff_login');
      if (isUniqueViolation(err)) {
        throw new ConflictException('This mobile number already has a Morbeez login, here or in another business. Use a different number.');
      }
      throw err;
    }
    const existing = await client.query<{ id: string }>('SELECT id FROM identity.role WHERE name = $1', [roleName]);
    const roleId = existing.rows[0]?.id ?? (await this.roles.createWithClient(client, tenantId, roleName)).id;
    // Also on an existing role: a permission added to the set later reaches every business.
    for (const code of STAFF_ROLES[roleName]) await this.roles.assignPermissionWithClient(client, roleId, code);
    await this.roles.assignToUserWithClient(client, user.id, roleId);
    return toPublicUser(user);
  }

  /**
   * A one-time link for choosing a password — for a new staff login, or a
   * new password when one is forgotten. Earlier open links for the same
   * person stop working. Returns the token; only its hash is stored.
   */
  async issuePasswordSetupWithClient(
    client: PoolClient,
    tenantId: string,
    userId: string,
    createdBy: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const exists = await client.query('SELECT 1 FROM identity.app_user WHERE id = $1', [userId]);
    if (!exists.rowCount) throw new NotFoundException('User not found');
    await this.setups.useAllForUserWithClient(client, userId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_SETUP_DAYS * 24 * 60 * 60 * 1000);
    await this.setups.createWithClient(client, tenantId, userId, hashToken(token), expiresAt, createdBy);
    return { token, expiresAt };
  }

  /** For the set-up page: whose link it is, and whether it still works. */
  async describePasswordSetup(token: string): Promise<PasswordSetupInfo> {
    const setup = await this.setups.findByHash(hashToken(token));
    if (!setup) throw new NotFoundException('This link is not valid. Ask for a new one.');
    return this.db.withTenant(setup.tenant_id, async (client) => {
      const r = await client.query<{ phone: string | null; email: string | null; business: string; name: string | null }>(
        `SELECT u.phone, u.email, t.name AS business,
                (SELECT e.name FROM trading_partners.employee e WHERE e.user_id = u.id LIMIT 1) AS name
         FROM identity.app_user u JOIN tenant.tenant t ON t.id = u.tenant_id
         WHERE u.id = $1`,
        [setup.user_id],
      );
      const row = r.rows[0];
      if (!row) throw new NotFoundException('This link is not valid. Ask for a new one.');
      return {
        state: setup.used_at ? 'used' : setup.expires_at.getTime() < Date.now() ? 'expired' : 'valid',
        business: row.business,
        name: row.name,
        login: row.phone ? maskPhone(row.phone) : (row.email ?? ''),
      };
    });
  }

  /** Sets the password from a set-up link; the link then stops working, and any open sessions end. */
  async completePasswordSetup(token: string, plaintextPassword: string): Promise<{ login: string }> {
    const setup = await this.setups.findByHash(hashToken(token));
    if (!setup) throw new NotFoundException('This link is not valid. Ask for a new one.');
    const passwordHash = await this.password.hash(plaintextPassword);
    return this.db.withTenant(setup.tenant_id, async (client) => {
      const current = await this.setups.lockWithClient(client, setup.id);
      if (!current || current.used_at) throw new GoneException('This link has already been used. Sign in, or ask for a new link.');
      if (current.expires_at.getTime() < Date.now()) throw new GoneException('This link has expired. Ask for a new one.');
      const r = await client.query<{ phone: string | null; email: string | null }>(
        `UPDATE identity.app_user SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING phone, email`,
        [passwordHash, current.user_id],
      );
      await this.setups.useAllForUserWithClient(client, current.user_id);
      await client.query('UPDATE identity.auth_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [current.user_id]);
      const user = r.rows[0];
      return { login: user?.phone ?? user?.email ?? '' };
    });
  }

  /** The signed-in person's own settings. */
  async preferences(tenantId: string, userId: string): Promise<{ language: string }> {
    return { language: await this.users.languageOf(tenantId, userId) };
  }

  async setPreferences(tenantId: string, userId: string, prefs: { language: string }): Promise<{ language: string }> {
    await this.users.setLanguage(tenantId, userId, prefs.language);
    return { language: prefs.language };
  }

  async list(tenantId: string): Promise<PublicUser[]> {
    const records = await this.users.list(tenantId);
    return records.map(toPublicUser);
  }

  async create(tenantId: string, login: LoginIdentity, plaintextPassword: string): Promise<PublicUser> {
    const passwordHash = await this.password.hash(plaintextPassword);
    try {
      const user = await this.users.create(tenantId, login, passwordHash);
      return toPublicUser(user);
    } catch (err) {
      // A phone or an email is one login across every tenant
      // (app_user_phone_unique, app_user_email_unique; Security Audit
      // SA-01) — the one error translation worth doing here, so the API
      // returns 409 instead of a raw 500.
      if (isUniqueViolation(err)) throw loginTaken(err);
      throw err;
    }
  }

  async deactivate(tenantId: string, userId: string): Promise<PublicUser> {
    const user = await this.users.updateStatus(tenantId, userId, 'deactivated');
    if (!user) throw new NotFoundException('User not found');
    // A deactivated user's existing sessions must not keep working —
    // status alone isn't checked again until the access token expires.
    await this.sessions.revokeAllForUser(tenantId, userId);
    return toPublicUser(user);
  }

  async reactivate(tenantId: string, userId: string): Promise<PublicUser> {
    const user = await this.users.updateStatus(tenantId, userId, 'active');
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async changePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(tenantId, userId);
    if (!user) throw new NotFoundException('User not found');

    const matches = await this.password.verify(user.passwordHash, currentPassword);
    // 400, not 401: the caller is signed in, they mistyped a field. A 401 would
    // make the owner app treat it as an ended session and sign them out.
    if (!matches) throw new BadRequestException('Current password is incorrect');

    if (newPassword === currentPassword) {
      throw new BadRequestException('New password must differ from the current password');
    }

    const newHash = await this.password.hash(newPassword);
    await this.users.updatePasswordHash(tenantId, userId, newHash);
    // A password change is a credential rotation — every existing session,
    // including the one making this request, is revoked. The caller logs
    // in again with the new password (Constitution V.7's spirit: a
    // credential change should never leave old sessions quietly valid).
    await this.sessions.revokeAllForUser(tenantId, userId);
  }

  async assignRole(tenantId: string, userId: string, roleId: string): Promise<void> {
    await this.roles.assignToUser(tenantId, userId, roleId);
  }

  /** Which roles a user directly holds — used by ApprovalsService to resolve approval authority (Approvals imports UsersModule for this, never RolesRepository directly; Constitution I.3-I.4). */
  getRoleIdsForUserWithClient(client: PoolClient, userId: string): Promise<string[]> {
    return this.roles.getRoleIdsForUserWithClient(client, userId);
  }

  /**
   * Creates the first user of a brand-new tenant: an "Owner" role carrying
   * every permission that currently exists, assigned to a new user with
   * the given credentials. Called by TenantService.createBusinessAccount()
   * as one step of its own transaction — takes the open `client` rather
   * than opening its own, so tenant-row creation and owner-provisioning
   * either both succeed or both roll back together. Users owns "what an
   * Owner is"; Tenant owns "when a business account gets one"
   * (Constitution I.3 — the business logic stays in the module whose
   * concern it actually is, even when another module orchestrates the
   * transaction).
   */
  async provisionOwner(
    client: PoolClient,
    tenantId: string,
    login: LoginIdentity,
    plaintextPassword: string,
  ): Promise<PublicUser> {
    const passwordHash = await this.password.hash(plaintextPassword);
    const user = await this.users.createWithClient(client, tenantId, login, passwordHash);

    const ownerRole = await this.roles.createWithClient(client, tenantId, 'Owner');
    const permissionCodes = await this.roles.listAllPermissionCodesWithClient(client);
    for (const code of permissionCodes) {
      await this.roles.assignPermissionWithClient(client, ownerRole.id, code);
    }
    await this.roles.assignToUserWithClient(client, user.id, ownerRole.id);

    return toPublicUser(user);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** A 409 naming which login is taken — the phone or the email. */
export function loginTaken(err: unknown): ConflictException {
  const constraint = (err as { constraint?: string }).constraint ?? '';
  return new ConflictException(
    constraint.includes('phone')
      ? 'This mobile number already has a Morbeez login. Sign in instead, or use a different number.'
      : 'This email already has a Morbeez login. Sign in instead, or use a different email.',
  );
}

/** "+919845012345" → "+91 98•••••345": enough for the person to recognise their own number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+91/, '');
  return `+91 ${digits.slice(0, 2)}${'•'.repeat(Math.max(digits.length - 5, 0))}${digits.slice(-3)}`;
}
