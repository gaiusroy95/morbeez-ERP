import { Module } from '@nestjs/common';
import { CostingController } from './costing.controller';
import { CostingRepository } from './costing.repository';
import { CostingService } from './costing.service';

// Bounded context: Costing — cost allocation and true cost (Master Spec v3
// P5; Cost Allocation Engine; MS §34–36). Owns money.trip_cost,
// money.trip_cost_allocation and money.cost_allocation_setting, and reads
// what Logistics, Fleet, Stock, Workforce and Finance recorded. Logistics
// calls it as a trip closes; it depends on no module, so there is no cycle.
@Module({
  controllers: [CostingController],
  providers: [CostingService, CostingRepository],
  exports: [CostingService],
})
export class CostingModule {}
