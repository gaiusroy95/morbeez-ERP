import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { TenantRepository } from './repositories/tenant.repository';
import { UsersModule } from '../users/users.module';

// Bounded context: Tenant — the subscribing business itself (Domain
// Model, Tier 00). Owns tenant.tenant, which carries no tenant_id and has
// no RLS policy, because it IS the tenant — access to a specific row is
// an application-layer decision (TenantController/TenantService always
// use the caller's own tenantId from the verified JWT), not a database
// one (Constitution IV.2). Imports UsersModule to provision a business
// account's first Owner as one step of its own signup transaction
// (Constitution I.3-I.4 — through Users' public API, not its internals).
@Module({
  imports: [UsersModule],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository],
  exports: [TenantService],
})
export class TenantModule {}
