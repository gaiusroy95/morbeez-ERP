import { Module } from '@nestjs/common';
import { LogisticsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';

// Bounded context: Logistics
// Owns its own schema (database/schemas/) and communicates with other
// modules only through published events or public APIs (Constitution I.3-I.4).
@Module({
  imports: [],
  controllers: [LogisticsController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
