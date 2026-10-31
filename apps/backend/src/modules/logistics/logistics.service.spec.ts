import { Test } from '@nestjs/testing';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';
import { PoolClient } from 'pg';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { closingStockOf, LogisticsService, mondayOf, quantitiesOf } from './logistics.service';
import { TripsRepository } from './repositories/trips.repository';
import { TripStopsRepository } from './repositories/trip-stops.repository';
import { TripExpensesRepository } from './repositories/trip-expenses.repository';
import { TripReconciliationsRepository } from './repositories/trip-reconciliations.repository';
import { TripStopPhotosRepository } from './repositories/trip-stop-photos.repository';
import { TripStopPodsRepository } from './repositories/trip-stop-pods.repository';
import { CustomerCollectionsRepository } from './repositories/customer-collections.repository';
import { TripCashDepositsRepository } from './repositories/trip-cash-deposits.repository';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WorkforceService } from '../workforce/workforce.service';
import { ProcurementService } from '../procurement/procurement.service';
import { OrdersService } from '../orders/orders.service';
import { ReceivablesService } from '../finance/receivables.service';
import { LedgerService } from '../finance/ledger.service';
import { PayrollService } from '../workforce/payroll.service';
import { FleetService } from '../vehicles/fleet.service';
import { DelegationService } from './delegation.service';
import { AlertsRepository } from '../alerts/alerts.repository';
import { DeliveryMeasuresRepository } from './repositories/delivery-measures.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { TripRecord } from './entities/trip.entity';
import { TripStopRecord } from './entities/trip-stop.entity';
import { VehicleRecord } from '../vehicles/entities/vehicle.entity';
import { EmployeeRecord } from '../workforce/entities/employee.entity';
import { PickupRecord } from '../procurement/entities/pickup.entity';
import { OrderRecord } from '../orders/entities/customer-order.entity';
import { RoutesService } from '../routes/routes.service';
import { TripPlanningRepository } from './repositories/trip-planning.repository';
import { LotStockService } from '../procurement/lot-stock.service';
import { FarmStopsRepository } from './repositories/farm-stops.repository';
import { DeliveryStopsRepository } from './repositories/delivery-stops.repository';
import { CratesService } from '../crates/crates.service';
import { TripCollectionsRepository } from './repositories/trip-collections.repository';
import { DisputesService } from '../finance/disputes.service';
import { TripIncentivesService } from './trip-incentives.service';
import { BackhaulsRepository } from './repositories/backhauls.repository';
import { BackhaulRecord } from './entities/backhaul.entity';

const storage = { put: jest.fn().mockResolvedValue(undefined) };

const fakeClient = {} as PoolClient;

const baseVehicle: VehicleRecord = {
  id: 'vehicle-1',
  tenantId: 'tenant-1',
  registrationNumber: 'KA-01-AB-1234',
  capacityKg: '1000',
  fuelType: 'diesel',
  acquisitionCost: null,
  acquisitionDate: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const baseDriver: EmployeeRecord = {
  id: 'employee-1',
  tenantId: 'tenant-1',
  userId: 'user-driver-1',
  name: 'Test Driver',
  roleType: 'driver',
  employmentTerms: {},
  status: 'active',
  delegationLevel: 4,
  standingDelegation: true,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const baseTrip: TripRecord = {
  id: 'trip-1',
  tenantId: 'tenant-1',
  number: 'T-20261028-001',
  routeId: null,
  vehicleId: 'vehicle-1',
  driverEmployeeId: 'employee-1',
  packerEmployeeId: null,
  loaderEmployeeId: null,
  status: 'planned',
  plannedDate: null,
  advanceAmount: '500',
  startedAt: null,
  openingKm: null,
  startLatitude: null,
  startLongitude: null,
  deliveryStartedAt: null,
  closingKm: null,
  returnedAt: null,
  completedAt: null,
  submittedBy: null,
  cashDeclared: null,
  submitNote: null,
  reviewNote: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

// A trip whose stops all went to plan: one pickup, one delivery with proof, nothing owed.
const cleanFacts = {
  stops: [
    { id: 's1', type: 'pickup' as const, status: 'completed', name: 'Ramesh Patil', notes: null, hasPod: false },
    { id: 's2', type: 'delivery' as const, status: 'completed', name: 'Hotel Sagar', notes: null, hasPod: true },
  ],
  load: [{ product: 'Tomato', uom: 'kg', pickedUp: '100.000', delivered: '100.000', returned: '0.000' }],
  unpaidCashCustomers: [],
  expensesNeedingApproval: '0.00',
};

const basePickup: PickupRecord = {
  id: 'pickup-1',
  tenantId: 'tenant-1',
  purchaseOrderId: 'po-1',
  farmerId: 'farmer-1',
  vehicleId: null,
  driverEmployeeId: null,
  status: 'scheduled',
  scheduledAt: null,
  pickedUpAt: null,
  notes: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const baseOrder: OrderRecord = {
  id: 'order-1',
  tenantId: 'tenant-1',
  number: 1,
  deliveryDate: null,
  deliveryTime: null,
  routeId: null,
  plannedDriverId: null,
  plannedVehicleId: null,
  deliveryAddress: null,
  creditTermDays: null,
  notes: null,
  customerId: 'customer-1',
  status: 'confirmed',
  approvalRequestId: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

function makeStop(overrides: Partial<TripStopRecord>): TripStopRecord {
  return {
    id: 'stop-1',
    tripId: 'trip-1',
    sequenceNumber: 1,
    stopType: 'pickup',
    pickupId: 'pickup-1',
    orderId: null,
    status: 'pending',
    arrivedAt: null,
    completedAt: null,
    notes: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('LogisticsService', () => {
  let service: LogisticsService;
  let delegation: { assertCan: jest.Mock; authorityOnTrip: jest.Mock };
  let measures: { lineFactsWithClient: jest.Mock; insertWithClient: jest.Mock };
  let alertsRepo: { raiseWithClient: jest.Mock };
  let trips: jest.Mocked<TripsRepository>;
  let stops: jest.Mocked<TripStopsRepository>;
  let expenses: jest.Mocked<TripExpensesRepository>;
  let reconciliations: jest.Mocked<TripReconciliationsRepository>;
  let photos: jest.Mocked<TripStopPhotosRepository>;
  let pods: jest.Mocked<TripStopPodsRepository>;
  let collections: jest.Mocked<CustomerCollectionsRepository>;
  let vehicles: jest.Mocked<VehiclesService>;
  let workforce: jest.Mocked<WorkforceService>;
  let procurement: jest.Mocked<ProcurementService>;
  let orders: jest.Mocked<OrdersService>;
  let planning: jest.Mocked<TripPlanningRepository>;
  let lotStock: jest.Mocked<LotStockService>;
  let receivables: jest.Mocked<ReceivablesService>;
  let ledger: jest.Mocked<LedgerService>;
  let farmStops: jest.Mocked<FarmStopsRepository>;
  let deliveries: jest.Mocked<DeliveryStopsRepository>;
  let crates: { listTypes: jest.Mock; stopCountsProblemWithClient: jest.Mock; recordStopCountsWithClient: jest.Mock };
  let tripCollections: jest.Mocked<TripCollectionsRepository>;
  let disputes: { raise: jest.Mock; list: jest.Mock };
  let backhaulsRepo: { listByTripWithClient: jest.Mock; moneyWithClient: jest.Mock };
  let receivablesMock: { recordCollectionPaymentWithClient: jest.Mock; customerBalanceWithClient: jest.Mock };
  let payroll: { recordTripWorkWithClient: jest.Mock; recordLoadingWorkWithClient: jest.Mock };

  beforeEach(async () => {
    measures = { lineFactsWithClient: jest.fn().mockResolvedValue([]), insertWithClient: jest.fn() };
    alertsRepo = { raiseWithClient: jest.fn() };
    delegation = {
      assertCan: jest.fn(),
      authorityOnTrip: jest.fn().mockResolvedValue({ level: 4, can: { expense: true } }),
    };
    const module = await Test.createTestingModule({
      providers: [
        LogisticsService,
        { provide: ObjectStorageService, useValue: storage },
        {
          provide: TripsRepository,
          useValue: {
            list: jest.fn(),
            listForDriver: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            startWithClient: jest.fn(),
            startDeliveriesWithClient: jest.fn(),
            returnWithClient: jest.fn(),
            completeWithClient: jest.fn(),
            cancelWithClient: jest.fn(),
            markReconciledWithClient: jest.fn(),
            holdWithClient: jest.fn(),
            returnToDriverWithClient: jest.fn(),
          },
        },
        { provide: TripCashDepositsRepository, useValue: { listByTripWithClient: jest.fn(), createWithClient: jest.fn(), findByClientRefWithClient: jest.fn() } },
        {
          provide: TripStopsRepository,
          useValue: {
            listByTripWithClient: jest.fn(),
            findByIdWithClient: jest.fn(),
            nextSequenceNumberWithClient: jest.fn(),
            createWithClient: jest.fn(),
            completeWithClient: jest.fn(),
            skipWithClient: jest.fn(),
            arriveWithClient: jest.fn(),
            countPendingWithClient: jest.fn(),
            countWithClient: jest.fn(),
          },
        },
        {
          provide: TripExpensesRepository,
          useValue: { listByTripWithClient: jest.fn(), createWithClient: jest.fn(), sumByTripWithClient: jest.fn(), maxOdometerOnTripWithClient: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: TripReconciliationsRepository,
          useValue: {
            findByTripWithClient: jest.fn(),
            createWithClient: jest.fn(),
            spotSalesWithClient: jest.fn().mockResolvedValue({ cash: '0.00', pending: 0 }),
            moneyWithClient: jest.fn().mockResolvedValue({ cashCollections: '0.00', directPayments: '0.00', deposited: '0.00' }),
            reviewFactsWithClient: jest.fn().mockResolvedValue(cleanFacts),
          },
        },
        {
          provide: TripStopPhotosRepository,
          useValue: {
            listByStopWithClient: jest.fn(),
            createWithClient: jest.fn(),
            countByStopAndTypeWithClient: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: TripStopPodsRepository, useValue: { findByStopWithClient: jest.fn(), createWithClient: jest.fn() } },
        {
          provide: CustomerCollectionsRepository,
          useValue: { listByStopWithClient: jest.fn(), createWithClient: jest.fn() },
        },
        { provide: VehiclesService, useValue: { getById: jest.fn() } },
        { provide: WorkforceService, useValue: { getById: jest.fn(), getEmployeeIdForUser: jest.fn() } },
        {
          provide: ProcurementService,
          useValue: { getPickup: jest.fn(), completePickup: jest.fn(), acceptAtFarm: jest.fn() },
        },
        { provide: OrdersService, useValue: { getOrder: jest.fn(), markDelivered: jest.fn() } },
        {
          provide: ReceivablesService,
          useValue: {
            recordCollectionPaymentWithClient: jest.fn(),
            customerBalanceWithClient: jest.fn().mockResolvedValue({ invoicedOutstanding: '0.00', unappliedCredit: '0.00', balance: '0.00', overdue: '0.00', oldestOverdueDays: null }),
          },
        },
        {
          provide: TripCollectionsRepository,
          useValue: {
            deliveredCustomersWithClient: jest.fn().mockResolvedValue([]),
            collectedWithClient: jest.fn().mockResolvedValue({ byCustomer: new Map(), byMethod: new Map() }),
            disputedWithClient: jest.fn().mockResolvedValue(new Map()),
            invoiceOfOrderWithClient: jest.fn().mockResolvedValue('invoice-1'),
            sameOpenDisputeWithClient: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: DisputesService, useValue: { raise: jest.fn().mockResolvedValue({ id: 'dispute-1' }), list: jest.fn().mockResolvedValue([]) } },
        {
          provide: TripIncentivesService,
          useValue: {
            recordAtCloseWithClient: jest.fn(),
            forTrip: jest.fn().mockResolvedValue({ tripId: 'trip-1', tripNumber: 'T-1', final: false, lines: [], total: '0.00' }),
          },
        },
        {
          provide: BackhaulsRepository,
          useValue: {
            listByTripWithClient: jest.fn().mockResolvedValue([]),
            moneyWithClient: jest.fn().mockResolvedValue({ cash: '0.00', direct: '0.00' }),
          },
        },
        { provide: PayrollService, useValue: { recordTripWorkWithClient: jest.fn(), recordLoadingWorkWithClient: jest.fn() } },
        {
          provide: DeliveryStopsRepository,
          useValue: {
            factsWithClient: jest.fn().mockResolvedValue({
              qrToken: 'ABCD1234EF567890',
              customerName: 'Hotel Sagar',
              lines: [{ id: 'line-1', productName: 'Tomato', quantity: '350.000' }],
            }),
            insertShortfallsWithClient: jest.fn(),
            outcomesForTripWithClient: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: CratesService,
          useValue: {
            listTypes: jest.fn().mockResolvedValue([]),
            stopCountsProblemWithClient: jest.fn().mockResolvedValue(null),
            recordStopCountsWithClient: jest.fn(),
          },
        },
        {
          provide: FarmStopsRepository,
          useValue: {
            poProductsWithClient: jest.fn().mockResolvedValue([
              { productId: 'p-onion', name: 'Onion', uom: 'kg' },
              { productId: 'p-tomato', name: 'Tomato', uom: 'kg' },
              { productId: 'p-ginger', name: 'Ginger', uom: 'kg' },
            ]),
            activeWorkersWithClient: jest.fn().mockResolvedValue(new Map([['worker-1', 'Suresh'], ['worker-2', 'Ramesh']])),
            farmerNameWithClient: jest.fn().mockResolvedValue('Green Valley Farm'),
            insertLinesWithClient: jest.fn(),
            setCrewWithClient: jest.fn(),
            outcomesForTripWithClient: jest.fn().mockResolvedValue(new Map()),
            crewOptionsWithClient: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: FleetService, useValue: { assertRoadworthyWithClient: jest.fn(), recordFastagTollWithClient: jest.fn() } },
        { provide: DelegationService, useValue: delegation },
        { provide: DeliveryMeasuresRepository, useValue: measures },
        { provide: AlertsRepository, useValue: alertsRepo },
        { provide: RoutesService, useValue: { assertUsable: jest.fn() } },
        {
          provide: TripPlanningRepository,
          useValue: {
            todayWithClient: jest.fn().mockResolvedValue('2026-10-28'),
            activeTripOfOrderWithClient: jest.fn().mockResolvedValue(null),
            activeTripOfPickupWithClient: jest.fn().mockResolvedValue(null),
            routePositionsWithClient: jest.fn().mockResolvedValue(new Map()),
            quantitiesWithClient: jest.fn().mockResolvedValue([]),
            pendingDeliveryLineIdsWithClient: jest.fn().mockResolvedValue(['line-1', 'line-2']),
            lastOdometerWithClient: jest.fn().mockResolvedValue('48620.0'),
            laterTripOnVehicleWithClient: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: LotStockService,
          useValue: {
            loadOrderLinesWithClient: jest.fn(),
            carryOverWithClient: jest.fn().mockResolvedValue('0.000'),
            vehicleStockWithClient: jest.fn().mockResolvedValue([]),
            returnFromVehicleWithClient: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: LedgerService,
          useValue: {
            postTripAdvanceWithClient: jest.fn(),
            postTripExpenseWithClient: jest.fn(),
            postTripReconciliationWithClient: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(LogisticsService);
    trips = module.get(TripsRepository);
    stops = module.get(TripStopsRepository);
    expenses = module.get(TripExpensesRepository);
    reconciliations = module.get(TripReconciliationsRepository);
    photos = module.get(TripStopPhotosRepository);
    pods = module.get(TripStopPodsRepository);
    collections = module.get(CustomerCollectionsRepository);
    vehicles = module.get(VehiclesService);
    workforce = module.get(WorkforceService);
    procurement = module.get(ProcurementService);
    orders = module.get(OrdersService);
    planning = module.get(TripPlanningRepository);
    lotStock = module.get(LotStockService);
    receivables = module.get(ReceivablesService);
    ledger = module.get(LedgerService);
    farmStops = module.get(FarmStopsRepository);
    deliveries = module.get(DeliveryStopsRepository);
    crates = module.get(CratesService);
    tripCollections = module.get(TripCollectionsRepository);
    disputes = module.get(DisputesService);
    backhaulsRepo = module.get(BackhaulsRepository);
    receivablesMock = module.get(ReceivablesService);
    payroll = module.get(PayrollService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('createTrip refuses a non-driver employee', async () => {
    vehicles.getById.mockResolvedValue(baseVehicle);
    workforce.getById.mockResolvedValue({ ...baseDriver, roleType: 'warehouse' });

    await expect(
      service.createTrip('tenant-1', 'user-1', { vehicleId: 'vehicle-1', driverEmployeeId: 'employee-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("createTrip numbers the trip for its day and makes its stops in the route's visiting order", async () => {
    vehicles.getById.mockResolvedValue(baseVehicle);
    workforce.getById.mockResolvedValue(baseDriver);
    orders.getOrder.mockImplementation(async (_t, id) => ({ ...baseOrder, id, customerId: `customer-${id}`, status: 'confirmed' }));
    procurement.getPickup.mockResolvedValue(basePickup);
    trips.createWithClient.mockImplementation(async (_c, _t, _u, fields) => ({ ...baseTrip, number: fields.number, routeId: fields.routeId ?? null, plannedDate: fields.plannedDate }));
    stops.createWithClient.mockImplementation(async (_c, f) => ({ id: `stop-${f.sequenceNumber}`, ...f }) as unknown as TripStopRecord);
    // The route visits customer-b first, then the farmer, then customer-a.
    planning.routePositionsWithClient.mockResolvedValue(new Map([['customer-b', 1], ['farmer-1', 2], ['customer-a', 3]]));
    // The day's running number comes from the counter: the 7th trip today.
    const counter = jest.fn().mockResolvedValue({ rows: [{ last_number: 7 }] });
    Object.assign(fakeClient, { query: counter });

    const trip = await service.createTrip('tenant-1', 'user-1', {
      vehicleId: 'vehicle-1',
      driverEmployeeId: 'employee-1',
      plannedDate: '2026-10-28',
      routeId: 'route-1',
      orderIds: ['a', 'b', 'c'],
      pickupIds: ['pickup-1'],
    });

    delete (fakeClient as { query?: unknown }).query;
    expect(trip.number).toBe('T-20261028-007');
    expect(counter).toHaveBeenCalledWith(expect.stringContaining('document_counter'), ['tenant-1', 'trip:2026-10-28']);
    const made = stops.createWithClient.mock.calls.map(([, f]) => f.orderId ?? f.pickupId);
    // On the route in its order; customer-c isn't on it, so it comes last.
    expect(made).toEqual(['b', 'pickup-1', 'a', 'c']);
    expect(stops.createWithClient.mock.calls.map(([, f]) => f.sequenceNumber)).toEqual([1, 2, 3, 4]);
  });

  it("createTrip refuses an order that isn't confirmed, or is already on another trip", async () => {
    vehicles.getById.mockResolvedValue(baseVehicle);
    workforce.getById.mockResolvedValue(baseDriver);
    orders.getOrder.mockResolvedValueOnce({ ...baseOrder, status: 'placed' });
    await expect(
      service.createTrip('tenant-1', 'user-1', { vehicleId: 'vehicle-1', driverEmployeeId: 'employee-1', orderIds: ['order-1'] }),
    ).rejects.toThrow(/not confirmed/);

    orders.getOrder.mockResolvedValue({ ...baseOrder, status: 'confirmed' });
    planning.activeTripOfOrderWithClient.mockResolvedValueOnce('T-20261028-001');
    await expect(
      service.createTrip('tenant-1', 'user-1', { vehicleId: 'vehicle-1', driverEmployeeId: 'employee-1', orderIds: ['order-1'] }),
    ).rejects.toThrow(/already on trip T-20261028-001/);
    expect(trips.createWithClient).not.toHaveBeenCalled();
  });

  it('createTrip refuses the driver as their own packer or loader', async () => {
    vehicles.getById.mockResolvedValue(baseVehicle);
    workforce.getById.mockResolvedValue(baseDriver);
    await expect(
      service.createTrip('tenant-1', 'user-1', { vehicleId: 'vehicle-1', driverEmployeeId: 'employee-1', packerEmployeeId: 'employee-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the vehicle count at closing is checked against loaded + picked up − delivered − sold on the spot', () => {
    const rows = [
      { productId: 'p-tomato', product: 'Tomato', uom: 'kg', loaded: '100.000', procured: '50.000', delivered: '80.000', spotSold: '10.000', returned: '55.000', writtenOff: '5.000', toDeliver: '0.000', expected: '60.000' },
      { productId: 'p-egg', product: 'Eggs', uom: 'piece', loaded: '30.000', procured: '0.000', delivered: '30.000', spotSold: '0.000', returned: '0.000', writtenOff: '0.000', toDeliver: '0.000', expected: '0.000' },
    ];
    const closing = closingStockOf(rows, [{ productId: 'p-tomato', quantity: 55 }]);
    expect(closing).toEqual([
      expect.objectContaining({ productId: 'p-tomato', expected: '60.000', counted: '55.000' }),
      expect.objectContaining({ productId: 'p-egg', expected: '0.000', counted: '0.000' }),
    ]);
    const q = quantitiesOf(rows, closing);
    expect(q.balanced).toBe(false);
    expect(q.rows[0].difference).toBe('-5.000');
    expect(q.totalsKg).toEqual(
      expect.objectContaining({ loaded: '100.000', procured: '50.000', delivered: '80.000', spotSold: '10.000', expected: '60.000', counted: '55.000', writtenOff: '5.000' }),
    );
    expect(quantitiesOf(rows, null).balanced).toBeNull();
    expect(() => closingStockOf(rows, [{ productId: 'p-other', quantity: 3 }])).toThrow(/is not on it/);
  });

  it('createTrip refuses an inactive vehicle', async () => {
    vehicles.getById.mockResolvedValue({ ...baseVehicle, status: 'maintenance' });

    await expect(
      service.createTrip('tenant-1', 'user-1', { vehicleId: 'vehicle-1', driverEmployeeId: 'employee-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('getTrip refuses a driver who does not own the trip', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    workforce.getEmployeeIdForUser.mockResolvedValue('some-other-employee');

    await expect(service.getTrip('tenant-1', 'user-other-driver', false, 'trip-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('getTrip allows a dispatcher regardless of ownership', async () => {
    trips.findById.mockResolvedValue(baseTrip);

    const result = await service.getTrip('tenant-1', 'dispatcher-1', true, 'trip-1');

    expect(result).toEqual(baseTrip);
    expect(workforce.getEmployeeIdForUser).not.toHaveBeenCalled();
  });

  it('getTrip allows the trip\'s own driver', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');

    const result = await service.getTrip('tenant-1', 'user-driver-1', false, 'trip-1');

    expect(result).toEqual(baseTrip);
  });

  it('listMyTrips returns nothing for a login with no linked employee record', async () => {
    workforce.getEmployeeIdForUser.mockResolvedValue(null);

    const result = await service.listMyTrips('tenant-1', 'user-1', undefined, 1, 25);

    expect(result.items).toEqual([]);
    expect(trips.listForDriver).not.toHaveBeenCalled();
  });

  it('listMyTrips filters by the caller\'s own resolved employee id', async () => {
    workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');
    trips.listForDriver.mockResolvedValue({ items: [baseTrip], total: 1, page: 1, pageSize: 25 });

    await service.listMyTrips('tenant-1', 'user-driver-1', undefined, 1, 25);

    expect(trips.listForDriver).toHaveBeenCalledWith('tenant-1', 'employee-1', undefined, 1, 25);
  });

  it('startTrip refuses a trip with no stops', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.countWithClient.mockResolvedValue(0);

    await expect(
      service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('startTrip posts the cash advance in the same transaction', async () => {
    const startedAt = new Date('2026-09-20T03:00:00Z');
    trips.findById.mockResolvedValue(baseTrip);
    stops.countWithClient.mockResolvedValue(2);
    trips.startWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', advanceAmount: '1000.00', startedAt, version: 2 });

    await service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 });

    expect(ledger.postTripAdvanceWithClient).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'dispatcher-1', {
      id: 'trip-1',
      advanceAmount: '1000.00',
      occurredAt: startedAt,
    });
  });

  it("Start Day records the opening KM and where the phone was", async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.countWithClient.mockResolvedValue(2);
    trips.startWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', version: 2 });

    await service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1, openingKm: 48650, latitude: 12.31, longitude: 76.64, accuracyMeters: 8 });

    expect(planning.lastOdometerWithClient).toHaveBeenCalledWith(fakeClient, 'vehicle-1', 'trip-1');
    expect(trips.startWithClient).toHaveBeenCalledWith(fakeClient, 'trip-1', 1, { openingKm: 48650, latitude: 12.31, longitude: 76.64, accuracyMeters: 8 });
  });

  it("Start Day refuses an opening KM below the vehicle's last reading, and half a position", async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.countWithClient.mockResolvedValue(2);

    await expect(service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1, openingKm: 48600 })).rejects.toThrow(/below the vehicle's last reading, 48620 km/);
    await expect(service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1, latitude: 12.3 })).rejects.toBeInstanceOf(BadRequestException);
    expect(trips.startWithClient).not.toHaveBeenCalled();
  });

  it('a driver starts the trip planned for today, not one planned for later', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, plannedDate: '2026-10-29' });
    stops.countWithClient.mockResolvedValue(2);
    workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');

    await expect(service.startTrip('tenant-1', 'user-driver-1', false, 'trip-1', { version: 1 })).rejects.toThrow(/planned for 2026-10-29/);
  });

  it('pay settles weekly: the week runs from Monday', () => {
    expect(mondayOf('2026-10-28')).toBe('2026-10-26'); // a Wednesday
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // a Sunday
  });

  it("startTrip loads what's reserved for its deliveries onto the vehicle", async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.countWithClient.mockResolvedValue(2);
    trips.startWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', version: 2 });

    await service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 });

    expect(lotStock.loadOrderLinesWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'dispatcher-1', { id: 'trip-1', vehicleId: 'vehicle-1' }, [
      'line-1',
      'line-2',
    ]);
  });

  it('startTrip takes on whatever an earlier trip left on the vehicle', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.countWithClient.mockResolvedValue(2);
    trips.startWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', version: 2 });

    await service.startTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 });

    expect(lotStock.carryOverWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'dispatcher-1', { id: 'trip-1', vehicleId: 'vehicle-1' });
  });

  it('cancelling a trip on the road brings its vehicle stock back to the store', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    trips.cancelWithClient.mockResolvedValue({ ...baseTrip, status: 'cancelled', version: 2 });

    await service.cancelTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 });

    expect(lotStock.returnFromVehicleWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'dispatcher-1', { id: 'trip-1', vehicleId: 'vehicle-1' }, null, null);
  });

  it('recordExpense posts the expense to its transport account', async () => {
    const recordedAt = new Date();
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    expenses.createWithClient.mockResolvedValue({
      id: 'expense-1',
      tripId: 'trip-1',
      category: 'toll',
      amount: '85.00',
      notes: null,
      recordedBy: 'dispatcher-1',
      recordedAt,
      clientRef: null,
      decision: null,
      decisionNote: null,
      decidedAt: null,
      fuel: null,
      photos: 0,
      needsApproval: false,
      paidBy: 'cash',
    });

    await service.recordExpense('tenant-1', 'dispatcher-1', true, 'trip-1', { category: 'toll', amount: 85 });

    expect(ledger.postTripExpenseWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ id: 'expense-1', category: 'toll', amount: '85.00', occurredAt: recordedAt, paidBy: 'cash' }),
    );
  });

  it('recordExpense takes a toll paid by FASTag off the tag, not the float', async () => {
    const recordedAt = new Date();
    const fleet = (service as unknown as { fleet: { recordFastagTollWithClient: jest.Mock } }).fleet;
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    ledger.postTripExpenseWithClient.mockResolvedValue('entry-1');
    expenses.createWithClient.mockResolvedValue({
      id: 'expense-2', tripId: 'trip-1', category: 'toll', amount: '120.00', notes: null, recordedBy: 'dispatcher-1', recordedAt,
      clientRef: null, decision: null, decisionNote: null, decidedAt: null, fuel: null, photos: 0, needsApproval: false, paidBy: 'fastag',
    });

    await service.recordExpense('tenant-1', 'dispatcher-1', true, 'trip-1', { category: 'toll', amount: 120, paidBy: 'fastag' });

    expect(ledger.postTripExpenseWithClient).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'dispatcher-1', expect.objectContaining({ paidBy: 'fastag' }));
    expect(fleet.recordFastagTollWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ vehicleId: baseTrip.vehicleId, expenseId: 'expense-2', amount: '120.00', entryId: 'entry-1' }),
    );
  });

  it('recordExpense refuses fuel paid by FASTag', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    await expect(service.recordExpense('tenant-1', 'dispatcher-1', true, 'trip-1', { category: 'fuel', amount: 500, paidBy: 'fastag' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('addPickupStop requires the trip to still be planned', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });

    await expect(
      service.addPickupStop('tenant-1', 'dispatcher-1', 'trip-1', { pickupId: 'pickup-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('addDeliveryStop requires the order to be confirmed', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    orders.getOrder.mockResolvedValue({ ...baseOrder, status: 'placed' });

    await expect(
      service.addDeliveryStop('tenant-1', 'dispatcher-1', 'trip-1', { orderId: 'order-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('completePickupStop completes the underlying pickup with the trip\'s own vehicle and driver', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');
    stops.findByIdWithClient.mockResolvedValue(makeStop({}));
    procurement.getPickup.mockResolvedValue(basePickup);
    stops.completeWithClient.mockResolvedValue(makeStop({ status: 'completed' }));

    await service.completePickupStop('tenant-1', 'user-driver-1', false, 'trip-1', 'stop-1');

    expect(procurement.completePickup).toHaveBeenCalledWith('tenant-1', 'user-driver-1', 'pickup-1', {
      version: 1,
      vehicleId: 'vehicle-1',
      driverEmployeeId: 'employee-1',
    });
  });

  it('completePickupStop with farm weights accepts them at the farm onto the vehicle', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');
    stops.findByIdWithClient.mockResolvedValue(makeStop({}));
    procurement.getPickup.mockResolvedValue(basePickup);
    stops.completeWithClient.mockResolvedValue(makeStop({ status: 'completed' }));

    await service.completePickupStop('tenant-1', 'user-driver-1', false, 'trip-1', 'stop-1', {
      weights: [
        { productId: 'p-tomato', netQuantity: 985, rejectedQuantity: 15, rejectionReason: ' damaged ' },
        { productId: 'p-onion', netQuantity: 120 },
      ],
    });

    expect(procurement.acceptAtFarm).toHaveBeenCalledWith('tenant-1', 'user-driver-1', basePickup.purchaseOrderId, {
      pickupId: 'pickup-1',
      tripId: 'trip-1',
      vehicleId: 'vehicle-1',
      lines: [
        { productId: 'p-tomato', acceptedQuantity: 985, rejectedQuantity: 15, rejectionReason: 'damaged' },
        { productId: 'p-onion', acceptedQuantity: 120, rejectedQuantity: 0, rejectionReason: null },
      ],
    });
  });

  describe('the farmer stop (driver app D2)', () => {
    const farmLines = [
      { productId: 'p-tomato', outcome: 'accepted' as const, netQuantity: 480 },
      { productId: 'p-onion', outcome: 'accepted' as const, measuredBy: 'bags' as const, sacks: 7, kgPerBag: 45 },
      { productId: 'p-ginger', outcome: 'rejected' as const, reason: 'quality_issue' as const, note: ' soft ' },
    ];

    beforeEach(() => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');
      stops.findByIdWithClient.mockResolvedValue(makeStop({}));
      procurement.getPickup.mockResolvedValue(basePickup);
      stops.completeWithClient.mockResolvedValue(makeStop({ status: 'completed' }));
      procurement.acceptAtFarm.mockResolvedValue([
        { id: 'lot-tomato', productId: 'p-tomato', acceptedQuantity: '480.000' },
        { id: 'lot-onion', productId: 'p-onion', acceptedQuantity: '315.000' },
      ] as never);
    });

    it('receives what was accepted (bags as sacks × kg a bag), keeps every line, credits the crew and tells the owner of the rejection', async () => {
      await service.completePickupStop('tenant-1', 'user-driver-1', false, 'trip-1', 'stop-1', {
        lines: farmLines,
        packerEmployeeId: 'worker-1',
        loaderEmployeeId: 'worker-2',
      });

      expect(procurement.acceptAtFarm).toHaveBeenCalledWith('tenant-1', 'user-driver-1', 'po-1', expect.objectContaining({
        lines: [
          { productId: 'p-tomato', acceptedQuantity: 480, rejectedQuantity: 0, rejectionReason: null },
          { productId: 'p-onion', acceptedQuantity: 315, rejectedQuantity: 0, rejectionReason: null },
          { productId: 'p-ginger', acceptedQuantity: 0, rejectedQuantity: 0, rejectionReason: 'Quality issue: soft' },
        ],
      }));
      expect(farmStops.insertLinesWithClient).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'user-driver-1', 'stop-1', [
        expect.objectContaining({ productId: 'p-tomato', acceptedQuantity: '480.000', lotId: 'lot-tomato' }),
        expect.objectContaining({ productId: 'p-onion', acceptedQuantity: '315.000', measuredBy: 'bags', sacks: 7, kgPerBag: '45.000', lotId: 'lot-onion' }),
        expect.objectContaining({ productId: 'p-ginger', outcome: 'rejected', reason: 'quality_issue', note: 'soft', lotId: null }),
      ]);
      expect(farmStops.setCrewWithClient).toHaveBeenCalledWith(expect.anything(), 'stop-1', 'worker-1', 'worker-2');
      expect(payroll.recordLoadingWorkWithClient).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'user-driver-1', {
        tripNumber: baseTrip.number,
        workDate: '2026-10-28',
        place: 'Green Valley Farm',
        kg: '795.000',
        packerId: 'worker-1',
        loaderId: 'worker-2',
      });
      expect(alertsRepo.raiseWithClient).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.objectContaining({
        kind: 'procurement_issue',
        title: 'Rejected at Green Valley Farm: Ginger',
        dedupeKey: 'farm-rejected:stop-1',
      }));
    });

    it('refuses to complete while a product is neither accepted nor rejected — before anything is received', async () => {
      await expect(
        service.completePickupStop('tenant-1', 'user-driver-1', false, 'trip-1', 'stop-1', { lines: farmLines.slice(0, 2) }),
      ).rejects.toThrow('Ginger still open');
      expect(procurement.completePickup).not.toHaveBeenCalled();
      expect(procurement.acceptAtFarm).not.toHaveBeenCalled();
    });

    it("refuses a packer who isn't one of the business's active workers", async () => {
      await expect(
        service.completePickupStop('tenant-1', 'user-driver-1', false, 'trip-1', 'stop-1', { lines: farmLines, packerEmployeeId: 'stranger' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(procurement.completePickup).not.toHaveBeenCalled();
    });

    it('raises no alert when nothing was rejected', async () => {
      await service.completePickupStop('tenant-1', 'user-driver-1', false, 'trip-1', 'stop-1', {
        lines: [...farmLines.slice(0, 2), { productId: 'p-ginger', outcome: 'accepted', netQuantity: 190 }],
      });
      expect(alertsRepo.raiseWithClient).not.toHaveBeenCalled();
    });
  });

  describe("the delivery checklist (driver app D3)", () => {
    const tomatoOrder = {
      ...baseOrder,
      lines: [{ id: 'line-1', orderId: 'order-1', productId: 'p-tomato', quantity: '350.000', unitPrice: '30.00', deliveredQuantity: null }],
    };

    beforeEach(() => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }));
      orders.getOrder.mockResolvedValue(tomatoOrder);
      stops.completeWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', status: 'completed' }));
      photos.countByStopAndTypeWithClient.mockResolvedValue(1);
    });

    it("refuses another customer's QR before anything is delivered", async () => {
      await expect(
        service.completeDeliveryStop('tenant-1', 'user-driver-1', true, 'trip-1', 'stop-1', { recipientName: 'A', qrToken: 'MORBEEZ:C:FFFF0000FFFF0000', allUnloaded: true }),
      ).rejects.toThrow("This QR isn't Hotel Sagar's");
      expect(orders.markDelivered).not.toHaveBeenCalled();
    });

    it('refuses a delivery not unloaded, and a short line without its reason', async () => {
      await expect(
        service.completeDeliveryStop('tenant-1', 'user-driver-1', true, 'trip-1', 'stop-1', { recipientName: 'A', allUnloaded: false }),
      ).rejects.toThrow('Unload everything delivered');
      await expect(
        service.completeDeliveryStop('tenant-1', 'user-driver-1', true, 'trip-1', 'stop-1', {
          recipientName: 'A',
          allUnloaded: true,
          qrNote: 'QR missing',
          lines: [{ orderLineId: 'line-1', deliveredQuantity: 300 }],
        }),
      ).rejects.toThrow('Say why less Tomato was delivered');
      expect(orders.markDelivered).not.toHaveBeenCalled();
    });

    it('records the QR scanned, the shortfall and its reason, the crates — and tells the owner of the shortfall', async () => {
      await service.completeDeliveryStop('tenant-1', 'user-driver-1', true, 'trip-1', 'stop-1', {
        recipientName: 'A. Shopkeeper',
        qrToken: 'morbeez:c:abcd1234ef567890',
        allUnloaded: true,
        lines: [{ orderLineId: 'line-1', deliveredQuantity: 300, shortReason: 'customer_took_less', shortNote: ' slow day ' }],
        crates: [{ crateTypeId: 'crate-1', dropped: 20, collected: 18 }],
      });

      expect(pods.createWithClient).toHaveBeenCalledWith(fakeClient, 'user-driver-1', expect.objectContaining({ qrStatus: 'scanned', qrNote: null, allUnloaded: true }));
      expect(deliveries.insertShortfallsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-driver-1', 'stop-1', [
        { orderLineId: 'line-1', ordered: '350.000', delivered: '300.000', reason: 'customer_took_less', note: 'slow day' },
      ]);
      expect(alertsRepo.raiseWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', expect.objectContaining({
        kind: 'customer_rejection',
        title: 'Delivered short to Hotel Sagar: Tomato',
      }));
      expect(crates.recordStopCountsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-driver-1', 'trip-1', 'stop-1', {
        lines: [{ crateTypeId: 'crate-1', dropped: 20, collected: 18 }],
      });
    });

    it("a missing QR doesn't stop the delivery: it's recorded as not scanned, with why", async () => {
      await service.completeDeliveryStop('tenant-1', 'user-driver-1', true, 'trip-1', 'stop-1', { recipientName: 'A', allUnloaded: true, qrNote: ' Damaged ' });
      expect(pods.createWithClient).toHaveBeenCalledWith(fakeClient, 'user-driver-1', expect.objectContaining({ qrStatus: 'not_scanned', qrNote: 'Damaged' }));
      expect(deliveries.insertShortfallsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-driver-1', 'stop-1', []);
    });

    it("crates that don't add up never block the delivery: the owner is told instead", async () => {
      crates.stopCountsProblemWithClient.mockResolvedValue('The vehicle holds only 0 CR, not 20');
      await service.completeDeliveryStop('tenant-1', 'user-driver-1', true, 'trip-1', 'stop-1', {
        recipientName: 'A',
        allUnloaded: true,
        qrToken: 'ABCD1234EF567890',
        crates: [{ crateTypeId: 'crate-1', dropped: 20, collected: 0 }],
      });
      expect(orders.markDelivered).toHaveBeenCalled();
      expect(crates.recordStopCountsWithClient).not.toHaveBeenCalled();
      expect(alertsRepo.raiseWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', expect.objectContaining({ kind: 'inventory_mismatch', title: 'Crates at Hotel Sagar not recorded' }));
    });

    it('the owner app, sending no checklist, delivers short without a reason as before', async () => {
      await service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
        recipientName: 'A',
        signatureData: 'x',
        lines: [{ orderLineId: 'line-1', deliveredQuantity: 300 }],
      });
      expect(orders.markDelivered).toHaveBeenCalled();
      expect(pods.createWithClient).toHaveBeenCalledWith(fakeClient, 'dispatcher-1', expect.objectContaining({ qrStatus: null, allUnloaded: null }));
    });
  });

  describe('collections, return and handover (driver app D4)', () => {
    it('returnTrip records the closing KM — never below the opening KM, only on the road', async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress', openingKm: '48650.0' });
      await expect(service.returnTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { closingKm: 48600 })).rejects.toThrow('below the opening KM, 48650 km');
      trips.returnWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', closingKm: '48842.0', returnedAt: new Date() });
      expect((await service.returnTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { closingKm: 48842 })).closingKm).toBe('48842.0');
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'completed' });
      await expect(service.returnTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { closingKm: 48842 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('Return never reads less than the odometer at a pump on the trip (driver app D6)', async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress', openingKm: '48650.0' });
      expenses.maxOdometerOnTripWithClient.mockResolvedValueOnce(48800);
      await expect(service.returnTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { closingKm: 48790 })).rejects.toThrow('below the odometer at the pump on this trip, 48800 km');
      expect(trips.returnWithClient).not.toHaveBeenCalled();
    });

    it('a driver who set off with an opening KM hands over only after the closing KM', async () => {
      workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress', openingKm: '48650.0' });
      await expect(service.completeTrip('tenant-1', 'user-driver-1', false, 'trip-1', { version: 1 })).rejects.toThrow('Record the closing KM');
    });
  });

  describe("deciding a driver's expense (Approvals inbox, owner app Phase 7)", () => {
    const expense = (over: Record<string, unknown> = {}) => ({
      id: 'expense-1', tripId: 'trip-1', category: 'fuel', amount: '2500.00', notes: null, recordedBy: 'user-driver-1', recordedAt: new Date(),
      clientRef: null, needsApproval: true, decision: null, decisionNote: null, decidedAt: null, fuel: null, photos: 0, ...over,
    });

    beforeEach(() => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      (expenses as unknown as { findByIdWithClient: jest.Mock }).findByIdWithClient = jest.fn().mockResolvedValue(expense());
      (expenses as unknown as { decideWithClient: jest.Mock }).decideWithClient = jest.fn().mockResolvedValue(expense({ decision: 'approved' }));
    });

    it('approves it, once', async () => {
      const after = await service.decideExpense('tenant-1', 'owner-1', 'trip-1', 'expense-1', { approve: true });
      expect(after.decision).toBe('approved');
      expect((expenses as unknown as { decideWithClient: jest.Mock }).decideWithClient).toHaveBeenCalledWith(fakeClient, 'expense-1', 'owner-1', 'approved', null);
    });

    it('rejects it only with a reason, and never one within the driver’s authority', async () => {
      await expect(service.decideExpense('tenant-1', 'owner-1', 'trip-1', 'expense-1', { approve: false })).rejects.toThrow('Say why the expense is rejected');
      (expenses as unknown as { findByIdWithClient: jest.Mock }).findByIdWithClient.mockResolvedValue(expense({ needsApproval: false }));
      await expect(service.decideExpense('tenant-1', 'owner-1', 'trip-1', 'expense-1', { approve: true })).rejects.toThrow("nothing to approve");
    });

    it('a decision already made is the same request again — or a conflict when it differs', async () => {
      (expenses as unknown as { findByIdWithClient: jest.Mock }).findByIdWithClient.mockResolvedValue(expense({ decision: 'approved' }));
      expect((await service.decideExpense('tenant-1', 'owner-1', 'trip-1', 'expense-1', { approve: true })).decision).toBe('approved');
      await expect(service.decideExpense('tenant-1', 'owner-1', 'trip-1', 'expense-1', { approve: false, note: 'No bill' })).rejects.toThrow('already approved');
    });
  });

  describe('backhaul in the handover and the close (driver app D5)', () => {
    const at = new Date('2026-10-29T12:00:00Z');
    const backhaul = (over: Partial<BackhaulRecord>): BackhaulRecord => ({
      id: 'b-1', tripId: 'trip-1', pickupPlace: 'Mysuru Market', dropPlace: 'Gundlupet Base', rent: '3500.00', hirerName: null, notes: null,
      offeredBy: 'owner', status: 'accepted', skipReason: null, acceptedAt: at, pickupReachedAt: null, loadedAt: null, dropReachedAt: null,
      completedAt: null, cancelledAt: null, cancelReason: null, payment: null, photos: { load: 0, drop: 0, payment: 0 }, createdAt: at, version: 2,
      ...over,
    });

    it('the vehicle is not back (Return) while a backhaul is under way', async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress', openingKm: '48650.0' });
      backhaulsRepo.listByTripWithClient.mockResolvedValue([backhaul({})]);
      await expect(service.returnTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { closingKm: 48842 })).rejects.toThrow(
        'Finish the backhaul Mysuru Market → Gundlupet Base first, then record Return',
      );
      expect(trips.returnWithClient).not.toHaveBeenCalled();
    });

    it('the driver hands over once the backhaul is paid; the owner may complete the trip regardless', async () => {
      workforce.getEmployeeIdForUser.mockResolvedValue('employee-1');
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      stops.countPendingWithClient.mockResolvedValue(0);
      backhaulsRepo.listByTripWithClient.mockResolvedValue([backhaul({ status: 'completed', pickupReachedAt: at, loadedAt: at, dropReachedAt: at, completedAt: at })]);
      await expect(service.completeTrip('tenant-1', 'user-driver-1', false, 'trip-1', { version: 1 })).rejects.toThrow(
        'Record the payment for the backhaul Mysuru Market → Gundlupet Base first, before handing over',
      );
      trips.completeWithClient.mockResolvedValue({ ...baseTrip, status: 'completed' });
      // The submission alerts that follow need a database; the owner's trip is submitted before them.
      await service.completeTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 }).catch(() => undefined);
      expect(trips.completeWithClient).toHaveBeenCalled();
    });

    it('rent paid in cash is part of the cash to hand over; by UPI it went straight to the business', async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress', advanceAmount: '500.00' });
      expenses.sumByTripWithClient.mockResolvedValue(0);
      backhaulsRepo.moneyWithClient.mockResolvedValue({ cash: '3500.00', direct: '1200.00' });
      const handover = await service.getHandover('tenant-1', 'dispatcher-1', true, 'trip-1');
      expect(handover).toEqual(expect.objectContaining({ backhaulCash: '3500.00', expected: '4000.00', directPayments: '1200.00' }));
    });

    it('collections list the customers delivered on the trip with their whole outstanding, less what they dispute', async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      tripCollections.deliveredCustomersWithClient.mockResolvedValue([
        { customer_id: 'c-1', name: 'Hotel Sagar', phone: null, place: null, stop_id: 's-1', terms_days: 0 },
        { customer_id: 'c-2', name: 'Green Leaf', phone: null, place: null, stop_id: 's-2', terms_days: 7 },
      ]);
      receivablesMock.customerBalanceWithClient.mockImplementation(async (_c: unknown, id: string) => ({ balance: id === 'c-1' ? '48500.00' : '-200.00' }));
      tripCollections.collectedWithClient.mockResolvedValue({ byCustomer: new Map([['c-1', '1000.00']]), byMethod: new Map([['cash', '700.00'], ['upi', '300.00']]) });
      tripCollections.disputedWithClient.mockResolvedValue(new Map([['c-1', '500.00']]));

      const board = await service.getTripCollections('tenant-1', 'dispatcher-1', true, 'trip-1');

      expect(board.customers).toEqual([
        expect.objectContaining({ customerId: 'c-1', terms: 'cash', outstanding: '48500.00', disputed: '500.00', collectedOnTrip: '1000.00' }),
        expect.objectContaining({ customerId: 'c-2', terms: 'credit', outstanding: '0.00', disputed: '0.00' }),
      ]);
      expect(board.collected).toEqual({ cash: '700.00', upi: '300.00', bankTransfer: '0.00', cheque: '0.00', total: '1000.00' });
      expect(board.pending).toEqual({ customers: 1, amount: '48000.00' });
    });

    it('someone paying on the customer’s behalf says who; the reference goes with the payment', async () => {
      trips.findById.mockResolvedValue(baseTrip);
      orders.getOrder.mockResolvedValue({ id: 'order-1', customerId: 'customer-1' } as never);
      stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }));
      await expect(
        service.recordCollection('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', { amount: 500, method: 'upi', payer: 'third_party' }),
      ).rejects.toThrow('say who');
      collections.createWithClient.mockResolvedValue({ id: 'c', amount: '500.00', method: 'upi', notes: 'Paid by Ravi (son)', collectedAt: new Date(), intoDriverFloat: false, reference: 'UTR123' } as never);
      await service.recordCollection('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', { amount: 500, method: 'upi', payer: 'third_party', payerName: ' Ravi (son) ', reference: ' UTR123 ' });
      expect(collections.createWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'dispatcher-1', expect.objectContaining({ payer: 'third_party', payerName: 'Ravi (son)', reference: 'UTR123', notes: 'Paid by Ravi (son)' }));
      expect(receivablesMock.recordCollectionPaymentWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'dispatcher-1', expect.objectContaining({ reference: 'UTR123' }));
    });

    it("a dispute is raised on the delivery's invoice and the owner is told; a retry raises nothing more", async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1', status: 'completed' }));
      await service.raiseStopDispute('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', { amount: 2000, reason: ' Wrong rate on onion ' });
      expect(disputes.raise).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', { invoiceId: 'invoice-1', amount: 2000, reason: 'Wrong rate on onion' });
      expect(alertsRepo.raiseWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', expect.objectContaining({ kind: 'collection_discrepancy', title: 'Hotel Sagar disputes ₹2000.00' }));

      disputes.raise.mockClear();
      tripCollections.sameOpenDisputeWithClient.mockResolvedValue('dispute-1');
      disputes.list.mockResolvedValue([{ id: 'dispute-1' }]);
      expect((await service.raiseStopDispute('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', { amount: 2000, reason: 'Wrong rate on onion' })).id).toBe('dispute-1');
      expect(disputes.raise).not.toHaveBeenCalled();
    });

    it('a dispute needs a delivery that was made', async () => {
      trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
      stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }));
      await expect(service.raiseStopDispute('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', { amount: 1, reason: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('startDeliveries sets the delivery run off once, on a trip on the road', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'planned' });
    await expect(service.startDeliveries('tenant-1', 'dispatcher-1', true, 'trip-1')).rejects.toBeInstanceOf(ConflictException);

    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    trips.startDeliveriesWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', deliveryStartedAt: new Date() });
    expect((await service.startDeliveries('tenant-1', 'dispatcher-1', true, 'trip-1')).deliveryStartedAt).not.toBeNull();

    trips.startDeliveriesWithClient.mockClear();
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress', deliveryStartedAt: new Date() });
    await service.startDeliveries('tenant-1', 'dispatcher-1', true, 'trip-1');
    expect(trips.startDeliveriesWithClient).not.toHaveBeenCalled();
  });

  it('arriveAtStop records the arrival on a trip on the road, and only then', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'planned' });
    await expect(service.arriveAtStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1')).rejects.toBeInstanceOf(ConflictException);

    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(makeStop({}));
    stops.arriveWithClient.mockResolvedValue(makeStop({ arrivedAt: new Date() }));
    const arrived = await service.arriveAtStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1');
    expect(arrived.arrivedAt).not.toBeNull();

    stops.arriveWithClient.mockClear();
    stops.findByIdWithClient.mockResolvedValue(makeStop({ status: 'completed' }));
    await service.arriveAtStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1');
    expect(stops.arriveWithClient).not.toHaveBeenCalled();
  });

  it('completePickupStop refuses a driver acting on someone else\'s trip', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    workforce.getEmployeeIdForUser.mockResolvedValue('a-different-employee');

    await expect(
      service.completePickupStop('tenant-1', 'user-2', false, 'trip-1', 'stop-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(procurement.completePickup).not.toHaveBeenCalled();
  });

  it('completeDeliveryStop requires a signature or an existing POD photo', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(
      makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }),
    );
    photos.countByStopAndTypeWithClient.mockResolvedValue(0);

    await expect(
      service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
        recipientName: 'A. Shopkeeper',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.markDelivered).not.toHaveBeenCalled();
  });

  it('completeDeliveryStop succeeds with a signature, marks delivered, and files the POD', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(
      makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }),
    );
    orders.getOrder.mockResolvedValue(baseOrder);
    stops.completeWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', status: 'completed' }));

    await service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
      recipientName: 'A. Shopkeeper',
      signatureData: 'data:image/png;base64,abcd',
    });

    expect(orders.markDelivered).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', 'order-1', 1, new Map(), {
      delivered: new Map(),
      vehicleId: 'vehicle-1',
      tripId: 'trip-1',
    });
    expect(pods.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'dispatcher-1',
      expect.objectContaining({ tripStopId: 'stop-1', recipientName: 'A. Shopkeeper' }),
    );
  });

  it('completeDeliveryStop delivers what the driver entered, off the trip vehicle', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }));
    orders.getOrder.mockResolvedValue({
      ...baseOrder,
      lines: [{ id: 'line-1', orderId: 'order-1', productId: 'p-tomato', quantity: '350.000', unitPrice: '30.00', deliveredQuantity: null }],
    });
    stops.completeWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', status: 'completed' }));

    await service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
      recipientName: 'A. Shopkeeper',
      signatureData: 'data:image/png;base64,abcd',
      lines: [{ orderLineId: 'line-1', deliveredQuantity: 340.5 }],
    });

    expect(measures.lineFactsWithClient).not.toHaveBeenCalled();
    expect(orders.markDelivered).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', 'order-1', 1, new Map(), {
      delivered: new Map([['line-1', '340.500']]),
      vehicleId: 'vehicle-1',
      tripId: 'trip-1',
    });
  });

  it("live birds: the customer's weight settles the invoice; shrinkage beyond tolerance alerts the owner", async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }));
    orders.getOrder.mockResolvedValue(baseOrder);
    stops.completeWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', status: 'completed' }));
    measures.lineFactsWithClient.mockResolvedValue([
      { orderLineId: 'line-1', productId: 'p-bird', productName: 'Broiler (live)', kind: 'live_bird', uom: 'kg', quantity: '500.000', tolerancePct: '2.00', weighmentPhoto: 'optional' },
    ]);

    await service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
      recipientName: 'A. Shopkeeper',
      signatureData: 'data:image/png;base64,abcd',
      lines: [{ orderLineId: 'line-1', customerWeight: 485 }],
    });

    expect(orders.markDelivered).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', 'order-1', 1, new Map([['line-1', '485.000']]), expect.anything());
    expect(measures.insertWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ orderLineId: 'line-1', measure: expect.objectContaining({ loss: '15.000', lossPct: '3.00', withinTolerance: false }) }),
    );
    expect(alertsRepo.raiseWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', expect.objectContaining({ kind: 'shrinkage', severity: 'critical' }));
  });

  it("a customer weight needs the scale photo when the owner requires one, and only applies to live birds", async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }));
    orders.getOrder.mockResolvedValue(baseOrder);
    photos.countByStopAndTypeWithClient.mockResolvedValue(0);
    measures.lineFactsWithClient.mockResolvedValue([
      { orderLineId: 'line-1', productId: 'p-bird', productName: 'Broiler (live)', kind: 'live_bird', uom: 'kg', quantity: '500.000', tolerancePct: '2.00', weighmentPhoto: 'required' },
      { orderLineId: 'line-2', productId: 'p-tom', productName: 'Tomato', kind: 'standard', uom: 'kg', quantity: '10.000', tolerancePct: null, weighmentPhoto: 'required' },
    ]);
    const deliver = (lines: { orderLineId: string; customerWeight?: number }[]) =>
      service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', { recipientName: 'A', signatureData: 'x', lines });

    await expect(deliver([{ orderLineId: 'line-1', customerWeight: 495 }])).rejects.toThrow(/Photograph the customer's scale/);
    await expect(deliver([{ orderLineId: 'line-2', customerWeight: 9 }])).rejects.toThrow(/isn't sold by live weight/);
    expect(orders.markDelivered).not.toHaveBeenCalled();
  });

  it('completeDeliveryStop succeeds when a POD photo already exists, without a signature', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.findByIdWithClient.mockResolvedValue(
      makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }),
    );
    photos.countByStopAndTypeWithClient.mockResolvedValue(1);
    orders.getOrder.mockResolvedValue(baseOrder);
    stops.completeWithClient.mockResolvedValue(makeStop({ stopType: 'delivery', status: 'completed' }));

    await service.completeDeliveryStop('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
      recipientName: 'A. Shopkeeper',
    });

    expect(orders.markDelivered).toHaveBeenCalled();
  });

  it('addPhoto rejects an unsupported content type', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.findByIdWithClient.mockResolvedValue(makeStop({}));

    await expect(
      service.addPhoto('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', 'pickup', {
        buffer: Buffer.from('not-an-image'),
        mimetype: 'application/pdf',
        size: 12,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('addPhoto records the photo once the file is written', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.findByIdWithClient.mockResolvedValue(makeStop({}));
    photos.createWithClient.mockResolvedValue({
      id: 'photo-1',
      tripStopId: 'stop-1',
      photoType: 'pickup',
      productId: null,
      storageKey: 'tenant-1/stop-1/x.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 3,
      takenAt: new Date(),
      createdBy: 'dispatcher-1',
    });

    const result = await service.addPhoto('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', 'pickup', {
      buffer: Buffer.from('abc'),
      mimetype: 'image/jpeg',
      size: 3,
    });

    expect(result.photoType).toBe('pickup');
    // Stored under tenant/stop with '/' separators, whatever the OS — the key S3 will use.
    expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^tenant-1\/stop-1\/[0-9a-f-]{36}\.jpg$/), expect.any(Buffer), 'image/jpeg');
    expect(photos.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'dispatcher-1',
      expect.objectContaining({ tripStopId: 'stop-1', photoType: 'pickup', contentType: 'image/jpeg' }),
    );
  });

  it('recordCollection refuses a pickup stop', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    stops.findByIdWithClient.mockResolvedValue(makeStop({}));

    await expect(
      service.recordCollection('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
        amount: 500,
        method: 'cash',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recordCollection records the capture and a Finance payment for the order, in one transaction', async () => {
    trips.findById.mockResolvedValue(baseTrip);
    orders.getOrder.mockResolvedValue({ id: 'order-1', customerId: 'customer-1' } as never);
    stops.findByIdWithClient.mockResolvedValue(
      makeStop({ stopType: 'delivery', pickupId: null, orderId: 'order-1' }),
    );
    collections.createWithClient.mockResolvedValue({
      id: 'collection-1',
      tenantId: 'tenant-1',
      tripStopId: 'stop-1',
      orderId: 'order-1',
      amount: '500',
      method: 'cash',
      notes: null,
      collectedBy: 'dispatcher-1',
      collectedAt: new Date(),
      intoDriverFloat: true,
      clientRef: null,
      payer: 'customer',
      payerName: null,
      reference: null,
    });

    const result = await service.recordCollection('tenant-1', 'dispatcher-1', true, 'trip-1', 'stop-1', {
      amount: 500,
      method: 'cash',
    });

    expect(result.amount).toBe('500');
    expect(collections.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ tripStopId: 'stop-1', orderId: 'order-1', amount: 500, method: 'cash' }),
    );
    expect(receivables.recordCollectionPaymentWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ collectionId: 'collection-1', customerId: 'customer-1', orderId: 'order-1', amount: '500', method: 'cash' }),
    );
    // Cash stays with the driver until handover: the trip's float, not the cash drawer.
    expect(collections.createWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'dispatcher-1', expect.objectContaining({ intoDriverFloat: true }));
    expect(receivables.recordCollectionPaymentWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ receivedInto: 'cash_with_drivers' }),
    );
  });

  it('completeTrip refuses while stops are still pending', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    stops.countPendingWithClient.mockResolvedValue(2);

    await expect(
      service.completeTrip('tenant-1', 'dispatcher-1', true, 'trip-1', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recordExpense refuses against a reconciled trip', async () => {
    trips.findById.mockResolvedValue({ ...baseTrip, status: 'reconciled' });

    await expect(
      service.recordExpense('tenant-1', 'dispatcher-1', true, 'trip-1', { category: 'fuel', amount: 100 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  const storeReconciliation = () =>
    reconciliations.createWithClient.mockImplementation(async (_client, _by, fields) => ({
      ...fields,
      backhaulCash: fields.backhaulCash ?? '0.00',
      id: 'recon-1',
      advanceAmount: String(fields.advanceAmount),
      totalExpenses: String(fields.totalExpenses),
      cashReturned: String(fields.cashReturned),
      variance: String(fields.variance),
      reconciledBy: 'user-1',
      reconciledAt: new Date(),
      closingStock: fields.closingStock ?? null,
    }));

  it('reconcileTrip: the driver hands over exactly what was expected — closes as a pass', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed', advanceAmount: '500', cashDeclared: '1400.00' });
    expenses.sumByTripWithClient.mockResolvedValue(300);
    reconciliations.moneyWithClient.mockResolvedValue({ cashCollections: '1200.00', directPayments: '800.00', deposited: '0.00' });
    storeReconciliation();
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });

    // 500 advance + 1,200 cash collected − 300 expenses = 1,400 expected
    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 1400 });

    expect(result.variance).toBe('0');
    expect(result.outcome).toBe('pass');
    expect(result.checklist?.every((c) => c.status === 'pass')).toBe(true);
    // No count: what's on the vehicle comes back as the books have it.
    expect(lotStock.returnFromVehicleWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', { id: 'trip-1', vehicleId: 'vehicle-1' }, null, null);
    // The float the ledger settles includes the delivery cash.
    expect(ledger.postTripReconciliationWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'user-1',
      expect.objectContaining({ advanceAmount: '500', cashIn: '1200.00', totalExpenses: '300', cashDeposited: '0.00', cashReturned: '1400' }),
    );
  });

  it("reconcileTrip counts the vehicle against what's on it and brings the stock back, short kilos written off", async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed', advanceAmount: '0' });
    expenses.sumByTripWithClient.mockResolvedValue(0);
    storeReconciliation();
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });
    lotStock.vehicleStockWithClient.mockResolvedValue([
      { vehicleId: 'vehicle-1', registrationNumber: 'KA-01', productId: 'p-tomato', product: 'Tomato', uom: 'kg', onVehicle: '385.000', reserved: '0.000', valueAtCost: '3850.00' },
    ]);

    await expect(
      service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 0, closingStock: [{ productId: 'p-tomato', quantity: 380 }] }),
    ).rejects.toThrow(/needs a reason/);

    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', {
      version: 1,
      cashReturned: 0,
      closingStock: [{ productId: 'p-tomato', quantity: 380 }],
      exceptionNote: '5 kg spoiled in the heat',
    });

    expect(result.closingStock).toEqual([expect.objectContaining({ productId: 'p-tomato', expected: '385.000', counted: '380.000' })]);
    expect(lotStock.returnFromVehicleWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      { id: 'trip-1', vehicleId: 'vehicle-1' },
      new Map([['p-tomato', '380.000']]),
      '5 kg spoiled in the heat',
    );
  });

  it('reconcileTrip leaves the vehicle stock to a later trip that has set off with it', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed', advanceAmount: '0' });
    expenses.sumByTripWithClient.mockResolvedValue(0);
    storeReconciliation();
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });
    planning.laterTripOnVehicleWithClient.mockResolvedValue('T-20261028-009');
    planning.quantitiesWithClient.mockResolvedValue([
      { productId: 'p-tomato', product: 'Tomato', uom: 'kg', loaded: '20.000', procured: '0.000', delivered: '0.000', spotSold: '0.000', returned: '0.000', writtenOff: '0.000', toDeliver: '0.000', expected: '20.000' },
    ]);

    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 0, closingStock: [{ productId: 'p-tomato', quantity: 20 }] });

    expect(result.closingStock).toEqual([expect.objectContaining({ productId: 'p-tomato', expected: '20.000', counted: '20.000' })]);
    expect(lotStock.vehicleStockWithClient).not.toHaveBeenCalled();
    expect(lotStock.returnFromVehicleWithClient).not.toHaveBeenCalled();
  });

  it('reconcileTrip: a short handover is an exception — closing it needs the owner\'s reason', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed', advanceAmount: '500' });
    expenses.sumByTripWithClient.mockResolvedValue(300);
    storeReconciliation();
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });

    await expect(service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 180 })).rejects.toThrow(/handover.*needs a reason/);

    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', {
      version: 1,
      cashReturned: 180,
      exceptionNote: 'Driver paid ₹20 toll without a receipt',
    });
    expect(result.variance).toBe('20');
    expect(result.outcome).toBe('approved_exception');
    expect(result.exceptionNote).toMatch(/toll/);
  });

  it('reconcileTrip: cash deposited in the bank on the road is not expected at handover', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'on_hold', advanceAmount: '0' });
    expenses.sumByTripWithClient.mockResolvedValue(0);
    reconciliations.moneyWithClient.mockResolvedValue({ cashCollections: '5000.00', directPayments: '0.00', deposited: '4000.00' });
    storeReconciliation();
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });

    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 1000 });

    expect(result.variance).toBe('0');
    expect(ledger.postTripReconciliationWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'user-1',
      expect.objectContaining({ cashIn: '5000.00', cashDeposited: '4000.00', cashReturned: '1000' }),
    );
  });

  it('reconcileTrip expects back the cash taken for spot sales, and waits for pending ones', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed', advanceAmount: '500' });
    expenses.sumByTripWithClient.mockResolvedValue(300);
    reconciliations.spotSalesWithClient.mockResolvedValueOnce({ cash: '0.00', pending: 1 });
    await expect(service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 200 })).rejects.toThrow(/await an approval/);

    reconciliations.spotSalesWithClient.mockResolvedValue({ cash: '1250.00', pending: 0 });
    storeReconciliation();
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });
    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 1450 });
    // 500 advance + 1,250 spot cash − 300 expenses − 1,450 returned
    expect(result.variance).toBe('0');
  });

  it('hold and return-to-driver only act on a trip waiting for the owner', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress' });
    await expect(service.holdTrip('tenant-1', 'user-1', 'trip-1', { version: 1, note: 'Check the cash' })).rejects.toBeInstanceOf(ConflictException);

    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed' });
    trips.returnToDriverWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress', reviewNote: 'Add the toll receipt', version: 2 });
    const back = await service.returnToDriver('tenant-1', 'user-1', 'trip-1', { version: 1, note: 'Add the toll receipt' });
    expect(back.status).toBe('in_progress');
    expect(trips.returnToDriverWithClient).toHaveBeenCalledWith(fakeClient, 'trip-1', 1, 'Add the toll receipt');
  });

  it('reconcileTrip refuses a trip that is not completed', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress' });

    await expect(
      service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
