import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

// Bounded context: Vehicles
// Owns its own schema (database/schemas/) and communicates with other
// modules only through published events or public APIs (Constitution I.3-I.4).
@Module({
  imports: [],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
