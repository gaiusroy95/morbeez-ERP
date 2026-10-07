import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { PickupsRepository } from './repositories/pickups.repository';
import { LotsRepository } from './repositories/lots.repository';
import { FarmersModule } from '../farmers/farmers.module';
import { ProductsModule } from '../products/products.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FinanceModule } from '../finance/finance.module';

// Bounded context: Procurement — farmer purchase orders, pickups, goods
// receipt (Lot creation), and grading. Owns commerce.purchase_order(_line)/
// lot/pickup; money.farmer_settlement is legacy, superseded by Finance's
// payables. Grading accrues the farmer payable through Finance's
// PayablesService in the grading transaction.
// Reaches Farmers/Products/Vehicles/Workforce only through their public
// service APIs (existence + status checks), and Approvals for the
// purchase_order sign-off gate at confirmation (Constitution I.3-I.4).
@Module({
  imports: [FarmersModule, ProductsModule, VehiclesModule, WorkforceModule, ApprovalsModule, FinanceModule, AlertsModule],
  controllers: [ProcurementController],
  providers: [
    ProcurementService,
    PurchaseOrdersRepository,
    PickupsRepository,
    LotsRepository,
  ],
  exports: [ProcurementService],
})
export class ProcurementModule {}
