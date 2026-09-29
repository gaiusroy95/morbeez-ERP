import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import configuration from './config/configuration';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { DatabaseModule } from './infra/database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { LoggerModule } from './infra/logging/logger.module';
import { AuditModule } from './infra/audit/audit.module';
import { RateLimitModule } from './infra/rate-limit/rate-limit.module';
import { TenantRateLimitInterceptor } from './infra/rate-limit/tenant-rate-limit.interceptor';
import { HealthModule } from './health/health.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FarmersModule } from './modules/farmers/farmers.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { TaxModule } from './modules/tax/tax.module';
import { WorkforceModule } from './modules/workforce/workforce.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { CratesModule } from './modules/crates/crates.module';
import { SpotSalesModule } from './modules/spot-sales/spot-sales.module';
import { AiModule } from './modules/ai/ai.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

// The modular monolith root. Each import below is a bounded context
// (Domain Model) with its own module boundary enforced by Nest's DI
// container (Constitution I.3).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    LoggerModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    AuditModule,
    HealthModule,
    TenantModule,
    UsersModule,
    ApprovalsModule,
    CustomersModule,
    FarmersModule,
    ProductsModule,
    OrdersModule,
    ProcurementModule,
    InventoryModule,
    LogisticsModule,
    FinanceModule,
    AccountingModule,
    TaxModule,
    WorkforceModule,
    VehiclesModule,
    CratesModule,
    SpotSalesModule,
    AiModule,
    DashboardModule,
  ],
  providers: [
    // Validation: every request DTO is checked before it reaches a
    // controller (Constitution "Validation"); unknown fields are rejected
    // outright rather than silently ignored.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    },
    // Error handling: one consistent envelope for every error, anywhere
    // in the app (Constitution IV.6).
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Per-tenant request budget (Constitution IV.7, Security Audit SA-02).
    { provide: APP_INTERCEPTOR, useClass: TenantRateLimitInterceptor },
  ],
})
export class AppModule {}
