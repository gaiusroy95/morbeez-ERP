import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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
import { VehiclesService } from '../vehicles/vehicles.service';
import { WorkforceService } from '../workforce/workforce.service';
import { ProcurementService } from '../procurement/procurement.service';
import { OrdersService } from '../orders/orders.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { TripRecord } from './entities/trip.entity';
import { TripStopRecord } from './entities/trip-stop.entity';
import { VehicleRecord } from '../vehicles/entities/vehicle.entity';
import { EmployeeRecord } from '../workforce/entities/employee.entity';
import { PickupRecord } from '../procurement/entities/pickup.entity';
import { OrderRecord } from '../orders/entities/customer-order.entity';

// A partial mock — only the two fs.promises methods addPhoto actually
// calls. Anything else (argon2's native-binary loader, required
// transitively through Procurement -> Approvals -> Users, uses real fs
// internals) keeps working against the real module.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));

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
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
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

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LogisticsService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('/tmp/uploads') } },
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
          },
        },
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
          useValue: { findByTripWithClient: jest.fn(), createWithClient: jest.fn() },
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

    expect(orders.markDelivered).toHaveBeenCalledWith('tenant-1', 'dispatcher-1', 'order-1', 1);
    expect(pods.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'dispatcher-1',
      expect.objectContaining({ tripStopId: 'stop-1', recipientName: 'A. Shopkeeper' }),
    );
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

  it('recordCollection records a payment against a delivery stop', async () => {
    trips.findById.mockResolvedValue(baseTrip);
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

  it('reconcileTrip computes variance from the advance, recorded expenses, and cash returned', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'completed', advanceAmount: '500' });
    expenses.sumByTripWithClient.mockResolvedValue(300);
    reconciliations.createWithClient.mockImplementation(async (_client, _by, fields) => ({
      id: 'recon-1',
      tripId: fields.tripId,
      advanceAmount: String(fields.advanceAmount),
      totalExpenses: String(fields.totalExpenses),
      cashReturned: String(fields.cashReturned),
      variance: String(fields.variance),
      notes: fields.notes,
      reconciledBy: 'user-1',
      reconciledAt: new Date(),
    }));
    trips.markReconciledWithClient.mockResolvedValue({ ...baseTrip, status: 'reconciled', version: 2 });

    const result = await service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 180 });

    expect(result.variance).toBe('20');
  });

  it('reconcileTrip refuses a trip that is not completed', async () => {
    trips.findByIdWithClient.mockResolvedValue({ ...baseTrip, status: 'in_progress' });

    await expect(
      service.reconcileTrip('tenant-1', 'user-1', 'trip-1', { version: 1, cashReturned: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
