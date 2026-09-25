import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { TenantRepository } from './repositories/tenant.repository';
import { TenantRecord } from './entities/tenant.entity';
import { UsersService } from '../users/users.service';
import { PublicUser } from '../users/entities/user.entity';

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
    ownerEmail: string,
    ownerPassword: string,
  ): Promise<NewBusinessAccount> {
    return this.db.transaction(async (client) => {
      const tenant = await this.tenants.createWithClient(
        client,
        businessName,
        'INR',
        'Asia/Kolkata',
      );
      await this.db.setTenantContext(client, tenant.id);
      const owner = await this.users.provisionOwner(
        client,
        tenant.id,
        ownerEmail,
        ownerPassword,
      );
      return { tenant, owner };
    });
    // A thrown error anywhere above rolls back the whole transaction
    // (DatabaseService.transaction) — no orphaned tenant row, no manual
    // cleanup needed.
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
