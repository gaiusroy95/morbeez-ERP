import { Test } from '@nestjs/testing';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';
import { PoolClient } from 'pg';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
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
  vehicleId: 'vehicle-1',
  driverEmployeeId: 'employee-1',
  status: 'planned',
  plannedDate: null,
  advanceAmount: '500',
  startedAt: null,
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
  let receivables: jest.Mocked<ReceivablesService>;
  let ledger: jest.Mocked<LedgerService>;

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
            countPendingWithClient: jest.fn(),
            countWithClient: jest.fn(),
          },
        },
        {
          provide: TripExpensesRepository,
          useValue: { listByTripWithClient: jest.fn(), createWithClient: jest.fn(), sumByTripWithClient: jest.fn() },
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
          useValue: { getPickup: jest.fn(), completePickup: jest.fn() },
        },
        { provide: OrdersService, useValue: { getOrder: jest.fn(), markDelivered: jest.fn() } },
        { provide: ReceivablesService, useValue: { recordCollectionPaymentWithClient: jest.fn() } },
        { provide: PayrollService, useValue: { recordTripWorkWithClient: jest.fn() } },
        { provide: FleetService, useValue: { assertRoadworthyWithClient: jest.fn() } },
        { provide: DelegationService, useValue: delegation },
        { provide: DeliveryMeasuresRepository, useValue: measures },
        { provide: AlertsRepository, useValue: alertsRepo },
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
    receivables = module.get(ReceivablesService);
    ledger = module.get(LedgerService);
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
      needsApproval: false,
    });

    await service.recordExpense('tenant-1', 'dispatcher-1', true, 'trip-1', { category: 'toll', amount: 85 });

    expect(ledger.postTripExpenseWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'dispatcher-1',
      expect.objectContaining({ id: 'expense-1', category: 'toll', amount: '85.00', occurredAt: recordedAt }),
    );
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

    expect(orders.markDelivered).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', 'order-1', 1, new Map());
    expect(pods.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'dispatcher-1',
      expect.objectContaining({ tripStopId: 'stop-1', recipientName: 'A. Shopkeeper' }),
    );
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

    expect(orders.markDelivered).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', 'order-1', 1, new Map([['line-1', '485.000']]));
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
      id: 'recon-1',
      advanceAmount: String(fields.advanceAmount),
      totalExpenses: String(fields.totalExpenses),
      cashReturned: String(fields.cashReturned),
      variance: String(fields.variance),
      reconciledBy: 'user-1',
      reconciledAt: new Date(),
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
    // The float the ledger settles includes the delivery cash.
    expect(ledger.postTripReconciliationWithClient).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'user-1',
      expect.objectContaining({ advanceAmount: '500', cashIn: '1200.00', totalExpenses: '300', cashDeposited: '0.00', cashReturned: '1400' }),
    );
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
