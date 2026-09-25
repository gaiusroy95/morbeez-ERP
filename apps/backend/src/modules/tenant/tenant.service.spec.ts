import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantService } from './tenant.service';
import { TenantRepository } from './repositories/tenant.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { UsersService } from '../users/users.service';
import { TenantRecord } from './entities/tenant.entity';

const mockTenant: TenantRecord = {
  id: 'tenant-1',
  name: 'Dev Wholesaler Co.',
  plan: 'standard',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  taxRegistration: null,
  branding: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakeClient = {} as PoolClient;

describe('TenantService', () => {
  let service: TenantService;
  let db: jest.Mocked<DatabaseService>;
  let tenants: jest.Mocked<TenantRepository>;
  let users: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TenantService,
        {
          provide: DatabaseService,
          useValue: {
            transaction: jest.fn(),
            setTenantContext: jest.fn(),
          },
        },
        {
          provide: TenantRepository,
          useValue: {
            createWithClient: jest.fn(),
            findById: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: { provisionOwner: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(TenantService);
    db = module.get(DatabaseService);
    tenants = module.get(TenantRepository);
    users = module.get(UsersService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('creates the tenant, then sets its RLS context, then provisions the owner — in that order', async () => {
    const callOrder: string[] = [];
    tenants.createWithClient.mockImplementation(async () => {
      callOrder.push('createTenant');
      return mockTenant;
    });
    db.setTenantContext.mockImplementation(async () => {
      callOrder.push('setTenantContext');
    });
    users.provisionOwner.mockImplementation(async () => {
      callOrder.push('provisionOwner');
      return {
        id: 'user-1',
        tenantId: mockTenant.id,
        email: 'owner@example.com',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
    db.transaction.mockImplementation((work) => work(fakeClient));

    await service.createBusinessAccount('Dev Wholesaler Co.', 'owner@example.com', 'pw');

    expect(callOrder).toEqual(['createTenant', 'setTenantContext', 'provisionOwner']);
    // provisionOwner must be told the tenant that was just created, not a
    // stale or guessed id — this is the line that would catch a copy-paste
    // bug wiring the wrong tenant into the owner's row.
    expect(users.provisionOwner).toHaveBeenCalledWith(
      fakeClient,
      mockTenant.id,
      'owner@example.com',
      'pw',
    );
  });

  it('never partially succeeds: a failure provisioning the owner rolls back the tenant row too', async () => {
    tenants.createWithClient.mockResolvedValue(mockTenant);
    db.setTenantContext.mockResolvedValue(undefined);
    users.provisionOwner.mockRejectedValue(new Error('boom'));

    // DatabaseService.transaction is mocked here, but its real
    // implementation (database.service.ts) ROLLBACKs on any thrown error
    // — this test proves the service propagates the failure instead of
    // swallowing it, which is what makes that rollback actually happen in
    // production rather than committing a tenant with no usable login.
    db.transaction.mockImplementation((work) => work(fakeClient));

    await expect(
      service.createBusinessAccount('Dev Wholesaler Co.', 'owner@example.com', 'pw'),
    ).rejects.toThrow('boom');
  });

  it('getById throws NotFound rather than returning null for an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);

    await expect(service.getById('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
  });
});
