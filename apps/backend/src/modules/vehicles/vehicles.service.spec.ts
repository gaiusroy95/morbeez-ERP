import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { VehiclesService } from './vehicles.service';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { VehicleRecord } from './entities/vehicle.entity';

const mockVehicle: VehicleRecord = {
  id: 'vehicle-1',
  tenantId: 'tenant-1',
  registrationNumber: 'KA01AB1234',
  capacityKg: '2000.00',
  fuelType: 'diesel',
  acquisitionCost: '1500000.00',
  acquisitionDate: '2024-01-15',
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const fakeClient = {} as PoolClient;

describe('VehiclesService', () => {
  let service: VehiclesService;
  let repo: jest.Mocked<VehiclesRepository>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VehiclesService,
        {
          provide: VehiclesRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            updateWithClient: jest.fn(),
            setStatusWithClient: jest.fn(),
            bookStateWithClient: jest.fn().mockResolvedValue({ onBooks: false, disposalRecorded: false }),
          },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(VehiclesService);
    repo = module.get(VehiclesRepository);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('setStatus() records the status transition as an auditable before/after pair', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockVehicle);
    repo.setStatusWithClient.mockResolvedValue({ ...mockVehicle, status: 'maintenance', version: 2 });

    const result = await service.setStatus('tenant-1', 'user-1', 'vehicle-1', 'maintenance');

    expect(result.status).toBe('maintenance');
    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        entityType: 'vehicle',
        before: expect.objectContaining({ status: 'active' }),
        after: expect.objectContaining({ status: 'maintenance' }),
      }),
    );
  });

  it('setStatus() refuses to dispose of a capitalised vehicle without its disposal event (VEH.5)', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockVehicle);
    repo.bookStateWithClient.mockResolvedValue({ onBooks: true, disposalRecorded: false });
    await expect(service.setStatus('tenant-1', 'user-1', 'vehicle-1', 'disposed')).rejects.toThrow(/record its disposal/);
    expect(repo.setStatusWithClient).not.toHaveBeenCalled();
  });

  it('setStatus() never brings back a vehicle whose disposal is recorded', async () => {
    repo.findByIdWithClient.mockResolvedValue({ ...mockVehicle, status: 'disposed' });
    repo.bookStateWithClient.mockResolvedValue({ onBooks: true, disposalRecorded: true });
    await expect(service.setStatus('tenant-1', 'user-1', 'vehicle-1', 'active')).rejects.toThrow(/final/);
  });

  it('update() keeps the acquisition cost that the asset register set', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockVehicle);
    repo.bookStateWithClient.mockResolvedValue({ onBooks: true, disposalRecorded: false });
    await expect(service.update('tenant-1', 'user-1', 'vehicle-1', { version: 1, acquisitionCost: 1 })).rejects.toThrow(/asset register/);
    repo.updateWithClient.mockResolvedValue(mockVehicle);
    await expect(service.update('tenant-1', 'user-1', 'vehicle-1', { version: 1, acquisitionCost: 1500000, capacityKg: 2500 })).resolves.toBeDefined();
  });
});
