import { PinsController } from './pins.controller';
import { PinsService } from './pins.service';
import { Module } from '@nestjs/common';
import { LogisticsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';
import { TripsRepository } from './repositories/trips.repository';
import { TripStopsRepository } from './repositories/trip-stops.repository';
import { TripExpensesRepository } from './repositories/trip-expenses.repository';
import { TripReconciliationsRepository } from './repositories/trip-reconciliations.repository';
import { TripStopPhotosRepository } from './repositories/trip-stop-photos.repository';
import { TripStopPodsRepository } from './repositories/trip-stop-pods.repository';
import { CustomerCollectionsRepository } from './repositories/customer-collections.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { OrdersModule } from '../orders/orders.module';
import { FinanceModule } from '../finance/finance.module';

// Bounded context: Logistics — trip planning (vehicle, driver, route),
// stop execution (a Procurement pickup or a customer delivery), photos,
// proof of delivery, cash collections, expenses, and reconciliation. Owns
// fulfilment.trip/trip_stop/trip_expense/trip_reconciliation/
// trip_stop_photo/trip_stop_pod and money.customer_collection; reaches
// Vehicles/Workforce for assignment validation and trip-ownership
// resolution, and Procurement/Orders for completing the stops themselves —
// their public service APIs only (Constitution I.3-I.4). A collection is
// also recorded as a Finance customer payment, in the same transaction.
@Module({
  imports: [VehiclesModule, WorkforceModule, ProcurementModule, OrdersModule, FinanceModule],
  controllers: [LogisticsController, PinsController],
  providers: [
    LogisticsService,
    PinsService,
    TripsRepository,
    TripStopsRepository,
    TripExpensesRepository,
    TripReconciliationsRepository,
    TripStopPhotosRepository,
    TripStopPodsRepository,
    CustomerCollectionsRepository,
  ],
  exports: [LogisticsService],
})
export class LogisticsModule {}
