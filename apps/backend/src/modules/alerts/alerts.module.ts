import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsRepository } from './alerts.repository';
import { DaySummaryRepository } from './day-summary.repository';

// Owner alerts: exceptions at once, the rest in the evening summary (client
// Q&A 1 Oct 2026, E). Other modules raise alerts through AlertsRepository,
// inside their own transactions.
@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertsRepository, DaySummaryRepository],
  exports: [AlertsRepository],
})
export class AlertsModule {}
