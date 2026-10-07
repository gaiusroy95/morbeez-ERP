import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './repositories/customers.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CustomerRecord } from './entities/customer.entity';

const mockCustomer: CustomerRecord = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Test Restaurant',
  contact: {},
  preferredLanguage: 'en',
  creditLimit: '0.00',
  paymentTermsDays: 0,
  financeChargeRateMonthly: '0.00',
  financeChargeRateAnnual: '0.00',
  financeChargeGraceDays: 0,
  creditHold: false,
  creditHoldReason: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const fakeClient = {} as PoolClient;

describe('CustomersService', () => {
  let service: CustomersService;
  let repo: jest.Mocked<CustomersRepository>;
  let db: jest.Mocked<DatabaseService>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: CustomersRepository,
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
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(CustomersService);
    repo = module.get(CustomersRepository);
    db = module.get(DatabaseService);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('create() writes the entity and an audit "create" entry in the same transaction', async () => {
    repo.createWithClient.mockResolvedValue(mockCustomer);

    await service.create('tenant-1', 'user-1', { name: 'Test Restaurant' });

    expect(db.withTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        action: 'create',
        entityType: 'customer',
        entityId: mockCustomer.id,
      }),
    );
  });

  it('update() reads the before-state, applies the change, and audits both', async () => {
    const updated = { ...mockCustomer, name: 'Renamed', version: 2 };
    repo.findByIdWithClient.mockResolvedValue(mockCustomer);
    repo.updateWithClient.mockResolvedValue(updated);

    const result = await service.update('tenant-1', 'user-1', 'customer-1', {
      version: 1,
      name: 'Renamed',
    });

    expect(result).toEqual(updated);
    expect(repo.updateWithClient).toHaveBeenCalledWith(
      fakeClient,
      'customer-1',
      1,
      expect.objectContaining({ name: 'Renamed' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        action: 'update',
        before: mockCustomer,
        after: updated,
      }),
    );
  });

  it('update() throws NotFound before ever touching the optimistic-lock update, for an unknown id', async () => {
    repo.findByIdWithClient.mockResolvedValue(null);

    await expect(
      service.update('tenant-1', 'user-1', 'nonexistent', { version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.updateWithClient).not.toHaveBeenCalled();
  });

  it('archive() and restore() record distinct audit actions, not a generic "update"', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockCustomer);
    repo.setStatusWithClient.mockResolvedValue({ ...mockCustomer, status: 'archived' });

    await service.archive('tenant-1', 'user-1', 'customer-1');

    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ action: 'archive' }),
    );
  });
});
