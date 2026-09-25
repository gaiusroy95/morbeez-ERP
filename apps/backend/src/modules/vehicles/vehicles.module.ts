import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesRepository } from './repositories/vehicles.repository';

// Bounded context: Vehicles — the fleet (Domain Model, Trading Partners
// & Catalog tier). Financial treatment (depreciation, disposal) belongs
// to Accounting, not here.
@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesRepository],
  exports: [VehiclesService],
})
export class VehiclesModule {}
