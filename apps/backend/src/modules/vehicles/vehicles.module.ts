import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';
import { FleetRepository } from './repositories/fleet.repository';
import { FinanceModule } from '../finance/finance.module';
import { TaxRulesModule } from '../tax-rules/tax-rules.module';

// Bounded context: Vehicles — the fleet (Domain Model, Trading Partners
// & Catalog tier) and what it costs to run: fuel, maintenance, documents,
// the asset and its depreciation, loans, hired vehicles. Every money event
// posts through Finance's LedgerService; TDS on hire through the tax rules.
// Exports FleetService so Logistics can refuse a trip on an unfit vehicle.
@Module({
  imports: [FinanceModule, TaxRulesModule],
  controllers: [VehiclesController, FleetController],
  providers: [VehiclesService, VehiclesRepository, FleetService, FleetRepository],
  exports: [VehiclesService, FleetService],
})
export class VehiclesModule {}
