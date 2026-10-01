import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { TenantRepository } from './repositories/tenant.repository';
import { accessOf, TenantAccess, TenantRecord, TRIAL_DAYS } from './entities/tenant.entity';
import { isUniqueViolation, loginTaken, UsersService } from '../users/users.service';
import { LoginIdentity, PublicUser } from '../users/entities/user.entity';

export interface NewBusinessAccount {
  tenant: TenantRecord;
  owner: PublicUser;
}

@Injectable()
export class TenantService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantRepository,
    private readonly users: UsersService,
  ) {}

  /**
   * Creates the tenant row and its first Owner user in a single
   * transaction: the tenant_id doesn't exist until the first statement
   * creates it, so this can't go through withTenant() (which needs a
   * tenantId upfront) — it uses the lower-level transaction() +
   * setTenantContext() primitives instead, setting the RLS context to the
   * row it just created before the Owner-provisioning writes happen.
   * Either both succeed or neither does; there is no code path that
   * leaves a tenant with no usable login.
   */
  async createBusinessAccount(
    businessName: string,
    ownerLogin: LoginIdentity,
    ownerPassword: string,
    trialDays: number | null = TRIAL_DAYS,
  ): Promise<NewBusinessAccount> {
    try {
      return await this.db.transaction(async (client) => {
        const tenant = await this.tenants.createWithClient(
          client,
          businessName,
          'INR',
          'Asia/Kolkata',
          trialDays,
        );
        await this.db.setTenantContext(client, tenant.id);
        const owner = await this.users.provisionOwner(
          client,
          tenant.id,
          ownerLogin,
          ownerPassword,
        );
        return { tenant, owner };
      });
      // A thrown error anywhere above rolls back the whole transaction
      // (DatabaseService.transaction) — no orphaned tenant row, no manual
      // cleanup needed.
    } catch (err) {
      // The phone or email already logs in somewhere (Security Audit
      // SA-01). Saying so does confirm it has an account; signup is
      // rate-limited per IP for that reason (SA-02).
      if (isUniqueViolation(err)) throw loginTaken(err);
      throw err;
    }
  }

  // Where each business stands, for the check on every write
  // (TrialAccessInterceptor). Cached briefly: the answer changes once a
  // month, and a write shouldn't cost an extra query.
  private readonly accessCache = new Map<string, { access: TenantAccess; at: number }>();

  async access(tenantId: string): Promise<TenantAccess> {
    const hit = this.accessCache.get(tenantId);
    if (hit && Date.now() - hit.at < ACCESS_CACHE_MS) return hit.access;
    const access = accessOf(await this.getById(tenantId));
    this.accessCache.set(tenantId, { access, at: Date.now() });
    return access;
  }

  /** Records that a business has paid through [until] (the team's CLI). */
  async setSubscribedUntil(tenantId: string, until: Date | null): Promise<TenantRecord> {
    const tenant = await this.tenants.setSubscribedUntil(tenantId, until);
    if (!tenant) throw new NotFoundException('Tenant not found');
    this.accessCache.delete(tenantId);
    return tenant;
  }

  async getById(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(
    tenantId: string,
    fields: {
      name?: string;
      currency?: string;
      timezone?: string;
      taxRegistration?: string;
    },
  ): Promise<TenantRecord> {
    const tenant = await this.tenants.update(tenantId, fields);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }
}

const ACCESS_CACHE_MS = 60_000;
