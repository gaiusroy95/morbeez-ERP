import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { RoutesRepository } from './repositories/routes.repository';

// Bounded context: Routes — the business's delivery routes (Trading
// Partners & Catalog tier, like vehicles). Customers and Orders check a
// route through RoutesService before storing it; Logistics plans trips by
// route (redesign Phase 4).
@Module({
  controllers: [RoutesController],
  providers: [RoutesService, RoutesRepository],
  exports: [RoutesService],
})
export class RoutesModule {}
