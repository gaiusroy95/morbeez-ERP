import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FarmersModule } from './modules/farmers/farmers.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { WorkforceModule } from './modules/workforce/workforce.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { AiModule } from './modules/ai/ai.module';

// The modular monolith root. Each import below is a bounded context
// (Domain Model) with its own module boundary enforced by Nest's DI
// container (Constitution I.3).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TenantModule,
    UsersModule,
    CustomersModule,
    FarmersModule,
    ProductsModule,
    OrdersModule,
    ProcurementModule,
    InventoryModule,
    LogisticsModule,
    FinanceModule,
    AccountingModule,
    WorkforceModule,
    VehiclesModule,
    AiModule,
  ],
})
export class AppModule {}
