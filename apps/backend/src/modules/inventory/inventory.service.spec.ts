import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { LocationsRepository } from './repositories/locations.repository';
import { InventoryMovementsRepository } from './repositories/inventory-movements.repository';
import { ProductsService } from '../products/products.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ProcurementService } from '../procurement/procurement.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { LocationRecord } from './entities/location.entity';
import { LotRecord } from '../procurement/entities/lot.entity';
import { ProductRecord } from '../products/entities/product.entity';
import { VehicleRecord } from '../vehicles/entities/vehicle.entity';

const fakeClient = {} as PoolClient;

const baseLocation: LocationRecord = {
  id: 'location-1',
  tenantId: 'tenant-1',
  name: 'Main Warehouse',
  type: 'warehouse',
  vehicleId: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const baseProduct: ProductRecord = {
  id: 'product-1',
  tenantId: 'tenant-1',
  name: 'Tomato',
  category: 'vegetable',
  baseUom: 'kg',
  basePrice: '50',
  kind: 'standard',
  packSize: null,
  lossTolerancePct: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

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

function makeLot(overrides: Partial<LotRecord>): LotRecord {
  return {
    id: 'lot-1',
    tenantId: 'tenant-1',
    purchaseOrderId: 'po-1',
    farmerId: 'farmer-1',
    productId: 'product-1',
    pickupId: null,
    receivedQuantity: '100',
    acceptedQuantity: '100',
    rejectedQuantity: '0',
    grade: 'A',
    rejectionReason: null,
    unitCost: '10',
    status: 'available',
    reservedForOrderLineId: null,
    currentQuantity: '100',
    currentLocationId: null,
    receivedAt: new Date(),
    gradedAt: new Date(),
    gradedBy: 'user-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
    ...overrides,
  };
}

describe('InventoryService', () => {
  let service: InventoryService;
  let locations: jest.Mocked<LocationsRepository>;
  let movements: jest.Mocked<InventoryMovementsRepository>;
  let products: jest.Mocked<ProductsService>;
  let vehicles: jest.Mocked<VehiclesService>;
  let procurement: jest.Mocked<ProcurementService>;
  let ledger: jest.Mocked<LedgerService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: LocationsRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            updateWithClient: jest.fn(),
            setStatusWithClient: jest.fn(),
          },
        },
        {
          provide: InventoryMovementsRepository,
          useValue: {
            createWithClient: jest.fn().mockResolvedValue({ id: 'movement-x', quantity: '0.000', createdAt: new Date() }),
            listByLot: jest.fn(),
            listByProduct: jest.fn(),
          },
        },
        { provide: ProductsService, useValue: { getById: jest.fn() } },
        { provide: VehiclesService, useValue: { getById: jest.fn() } },
        {
          provide: ProcurementService,
          useValue: {
            listLotsForProduct: jest.fn(),
            getLot: jest.fn(),
            recordShrinkage: jest.fn(),
            recordRejectionPostAcceptance: jest.fn(),
            transferLot: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: LedgerService, useValue: { postInventoryWriteOffWithClient: jest.fn() } },
      ],
    }).compile();

    service = module.get(InventoryService);
    ledger = module.get(LedgerService);
    locations = module.get(LocationsRepository);
    movements = module.get(InventoryMovementsRepository);
    products = module.get(ProductsService);
    vehicles = module.get(VehiclesService);
    procurement = module.get(ProcurementService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('createLocation requires vehicleId when type is vehicle', async () => {
    await expect(
      service.createLocation('tenant-1', 'user-1', { name: 'Van 1', type: 'vehicle' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createLocation refuses vehicleId on a non-vehicle location', async () => {
    await expect(
      service.createLocation('tenant-1', 'user-1', { name: 'Cold Store', type: 'warehouse', vehicleId: 'vehicle-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createLocation validates the vehicle exists and is active for a vehicle location', async () => {
    vehicles.getById.mockResolvedValue(baseVehicle);
    locations.createWithClient.mockResolvedValue({ ...baseLocation, type: 'vehicle', vehicleId: 'vehicle-1' });

    await service.createLocation('tenant-1', 'user-1', { name: 'Van 1', type: 'vehicle', vehicleId: 'vehicle-1' });

    expect(vehicles.getById).toHaveBeenCalledWith('tenant-1', 'vehicle-1');
    expect(locations.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({ vehicleId: 'vehicle-1' }),
    );
  });

  it('getStockSummary computes physical, reserved, and available from mixed lot statuses', async () => {
    products.getById.mockResolvedValue(baseProduct);
    procurement.listLotsForProduct.mockResolvedValue([
      makeLot({ id: 'lot-1', status: 'available', currentQuantity: '40' }),
      makeLot({ id: 'lot-2', status: 'reserved', currentQuantity: '30' }),
      makeLot({ id: 'lot-3', status: 'rejected', currentQuantity: '0' }),
    ]);

    const summary = await service.getStockSummary('tenant-1', 'product-1');

    expect(summary.physical).toBe('70.000');
    expect(summary.reserved).toBe('30.000');
    expect(summary.available).toBe('40.000');
  });

  it('recordShrinkage delegates to Procurement and writes a movement entry', async () => {
    const shrunkLot = makeLot({ currentQuantity: '90', unitCost: '21.35' });
    procurement.recordShrinkage.mockResolvedValue(shrunkLot);
    const createdAt = new Date();
    movements.createWithClient.mockResolvedValue({
      id: 'movement-1',
      tenantId: 'tenant-1',
      lotId: 'lot-1',
      productId: shrunkLot.productId,
      movementType: 'shrinkage',
      quantity: '10.000',
      reason: 'evaporation',
      fromLocationId: null,
      toLocationId: null,
      createdAt,
      createdBy: 'user-1',
    });

    const result = await service.recordShrinkage('tenant-1', 'user-1', 'lot-1', {
      version: 1,
      quantity: 10,
      reason: 'evaporation',
    });

    expect(procurement.recordShrinkage).toHaveBeenCalledWith('tenant-1', 'user-1', 'lot-1', 1, 10);
    expect(movements.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({ movementType: 'shrinkage', quantity: 10, reason: 'evaporation' }),
    );
    // Written off at the lot's own cost, in the movement's transaction: 10 × 21.35.
    expect(ledger.postInventoryWriteOffWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', {
      movementId: 'movement-1',
      lotId: 'lot-1',
      kind: 'shrinkage',
      value: '213.50',
      reason: 'evaporation',
      occurredAt: createdAt,
    });
    expect(result).toBe(shrunkLot);
  });

  it('recordRejection delegates to Procurement and writes a movement entry', async () => {
    const rejectedLot = makeLot({ currentQuantity: '0', status: 'rejected' });
    procurement.recordRejectionPostAcceptance.mockResolvedValue(rejectedLot);

    await service.recordRejection('tenant-1', 'user-1', 'lot-1', { version: 1, quantity: 100, reason: 'mould' });

    expect(procurement.recordRejectionPostAcceptance).toHaveBeenCalledWith('tenant-1', 'user-1', 'lot-1', 1, 100);
    expect(movements.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({ movementType: 'rejected_post_acceptance', quantity: 100 }),
    );
  });

  it('transferLot refuses a destination location that is not active', async () => {
    locations.findById.mockResolvedValue({ ...baseLocation, status: 'archived' });

    await expect(
      service.transferLot('tenant-1', 'user-1', 'lot-1', { version: 1, toLocationId: 'location-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('transferLot refuses a lot with nothing left in it', async () => {
    locations.findById.mockResolvedValue(baseLocation);
    procurement.getLot.mockResolvedValue(makeLot({ currentQuantity: '0' }));

    await expect(
      service.transferLot('tenant-1', 'user-1', 'lot-1', { version: 1, toLocationId: 'location-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('transferLot records a movement with the previous and new location', async () => {
    locations.findById.mockResolvedValue(baseLocation);
    procurement.getLot.mockResolvedValue(makeLot({ currentLocationId: 'old-location', currentQuantity: '50' }));
    procurement.transferLot.mockResolvedValue(
      makeLot({ currentLocationId: 'location-1', currentQuantity: '50', version: 2 }),
    );

    await service.transferLot('tenant-1', 'user-1', 'lot-1', { version: 1, toLocationId: 'location-1' });

    expect(procurement.transferLot).toHaveBeenCalledWith('tenant-1', 'user-1', 'lot-1', 1, 'location-1');
    expect(movements.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({
        movementType: 'transferred',
        fromLocationId: 'old-location',
        toLocationId: 'location-1',
        quantity: 50,
      }),
    );
  });
});
