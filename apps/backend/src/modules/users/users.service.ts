import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { UsersRepository } from './repositories/users.repository';
import { RolesRepository } from './repositories/roles.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { PasswordService } from './security/password.service';
import { LoginIdentity, PublicUser, toPublicUser } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly sessions: AuthSessionsRepository,
    private readonly password: PasswordService,
  ) {}

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
