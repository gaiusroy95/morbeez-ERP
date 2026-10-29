import { Module } from '@nestjs/common';
import { SpotSalesController } from './spot-sales.controller';
import { SpotSalesService } from './spot-sales.service';
import { SpotSalesRepository } from './repositories/spot-sales.repository';
import { ApprovalsModule } from '../approvals/approvals.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { FinanceModule } from '../finance/finance.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { ProcurementModule } from '../procurement/procurement.module';

// Driver spot sales: selling from a vehicle on the road to walk-in buyers.
// Reads Logistics' trips and the vehicle's free kilos directly; takes the
// kilos off the vehicle through Procurement's LotStockService (driver app
// D0); posts through Finance; price exceptions go through Approvals; the
// driver is resolved through Workforce (DRV.16).
@Module({
  imports: [ApprovalsModule, WorkforceModule, FinanceModule, LogisticsModule, ProcurementModule],
  controllers: [SpotSalesController],
  providers: [SpotSalesService, SpotSalesRepository],
})
export class SpotSalesModule {}
