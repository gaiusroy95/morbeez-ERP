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
import { FarmStopsRepository } from './repositories/farm-stops.repository';
import { DeliveryStopsRepository } from './repositories/delivery-stops.repository';
import { TripCollectionsRepository } from './repositories/trip-collections.repository';
import { CratesModule } from '../crates/crates.module';
import { TripStopPodsRepository } from './repositories/trip-stop-pods.repository';
import { CustomerCollectionsRepository } from './repositories/customer-collections.repository';
import { TripCashDepositsRepository } from './repositories/trip-cash-deposits.repository';
import { DelegationsRepository } from './repositories/delegations.repository';
import { DeliveryMeasuresRepository } from './repositories/delivery-measures.repository';
import { DelegationService } from './delegation.service';
import { DelegationController } from './delegation.controller';
import { AlertsModule } from '../alerts/alerts.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { OrdersModule } from '../orders/orders.module';
import { FinanceModule } from '../finance/finance.module';
import { RoutesModule } from '../routes/routes.module';
import { TripPlanningRepository } from './repositories/trip-planning.repository';
import { BackhaulsRepository } from './repositories/backhauls.repository';
import { BackhaulService } from './backhaul.service';
import { BackhaulController } from './backhaul.controller';
import { DriverRecordsRepository } from './repositories/driver-records.repository';
import { DriverRecordsService } from './driver-records.service';
import { TripIncentivesRepository } from './repositories/trip-incentives.repository';
import { TripIncentivesService } from './trip-incentives.service';

// Bounded context: Logistics — trip planning (vehicle, driver, route),
// stop execution (a Procurement pickup or a customer delivery), photos,
// proof of delivery, cash collections, expenses, and reconciliation. Owns
// fulfilment.trip/trip_stop/trip_expense/trip_reconciliation/
// trip_stop_photo/trip_stop_pod/backhaul/trip_expense_photo and money.customer_collection; reaches
// Vehicles/Workforce for assignment validation and trip-ownership
// resolution, and Procurement/Orders for completing the stops themselves —
// their public service APIs only (Constitution I.3-I.4). A collection is
// also recorded as a Finance customer payment, in the same transaction.
@Module({
  imports: [VehiclesModule, WorkforceModule, ProcurementModule, OrdersModule, FinanceModule, AlertsModule, RoutesModule, CratesModule],
  controllers: [LogisticsController, PinsController, DelegationController, BackhaulController],
  providers: [
    LogisticsService,
    PinsService,
    TripsRepository,
    TripStopsRepository,
    TripExpensesRepository,
    TripReconciliationsRepository,
    TripStopPhotosRepository,
    FarmStopsRepository,
    DeliveryStopsRepository,
    TripCollectionsRepository,
    TripStopPodsRepository,
    CustomerCollectionsRepository,
    TripCashDepositsRepository,
    DelegationsRepository,
    DelegationService,
    DeliveryMeasuresRepository,
    TripPlanningRepository,
    BackhaulsRepository,
    BackhaulService,
    DriverRecordsRepository,
    DriverRecordsService,
    TripIncentivesRepository,
    TripIncentivesService,
  ],
  exports: [LogisticsService, DelegationService, PinsService],
})
export class LogisticsModule {}
