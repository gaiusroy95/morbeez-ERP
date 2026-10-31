import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CustomersModule } from '../customers/customers.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { DriverRequestsController } from './driver-requests.controller';
import { DriverRequestsRepository } from './driver-requests.repository';
import { DriverRequestsService } from './driver-requests.service';

// Driver requests (driver app D10): what a driver asks the office for from
// the road. Owns fulfilment.driver_request; approving one acts through the
// owning module's public service — Workforce's payroll for an advance,
// Customers for a new customer or a credit limit, Logistics' pins for where
// the new customer is — in the decision's own transaction.
@Module({
  imports: [WorkforceModule, CustomersModule, LogisticsModule, AlertsModule],
  controllers: [DriverRequestsController],
  providers: [DriverRequestsService, DriverRequestsRepository],
})
export class DriverRequestsModule {}
