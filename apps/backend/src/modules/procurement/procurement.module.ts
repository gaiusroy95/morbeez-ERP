import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { PickupsRepository } from './repositories/pickups.repository';
import { LotsRepository } from './repositories/lots.repository';
import { FarmerSettlementsRepository } from './repositories/farmer-settlements.repository';
import { FarmersModule } from '../farmers/farmers.module';
import { ProductsModule } from '../products/products.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { ApprovalsModule } from '../approvals/approvals.module';

// Bounded context: Procurement — farmer purchase orders, pickups, goods
// receipt (Lot creation), grading, and farmer settlement. Owns
// commerce.purchase_order(_line)/lot/pickup and money.farmer_settlement.
// Reaches Farmers/Products/Vehicles/Workforce only through their public
// service APIs (existence + status checks), and Approvals for the
// purchase_order sign-off gate at confirmation (Constitution I.3-I.4).
@Module({
  imports: [FarmersModule, ProductsModule, VehiclesModule, WorkforceModule, ApprovalsModule],
  controllers: [ProcurementController],
  providers: [
    ProcurementService,
    PurchaseOrdersRepository,
    PickupsRepository,
    LotsRepository,
    FarmerSettlementsRepository,
  ],
  exports: [ProcurementService],
})
export class ProcurementModule {}
