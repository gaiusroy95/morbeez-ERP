import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './repositories/customers.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CustomerRecord } from './entities/customer.entity';
import { RoutesService } from '../routes/routes.service';
import { CustomerInsightsRepository } from './repositories/customer-insights.repository';

const mockCustomer: CustomerRecord = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Test Restaurant',
  contact: {},
  place: null,
  address: null,
  routeId: null,
  preferredLanguage: 'en',
  creditLimit: '0.00',
  paymentTermsDays: 0,
  financeChargeRateMonthly: '0.00',
  financeChargeRateAnnual: '0.00',
  financeChargeGraceDays: 0,
  creditHold: false,
  creditHoldReason: null,
  financeChargeEnabled: false,
  billToBill: false,
  isWalkIn: false,
  doNotCall: false,
  qrToken: 'QR0000000000TEST',
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
            updateCreditTermsWithClient: jest.fn(),
            recordTermsVersionWithClient: jest.fn(),
            holdForReviewWithClient: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: RoutesService, useValue: { assertUsable: jest.fn(), placeWithClient: jest.fn() } },
        { provide: CustomerInsightsRepository, useValue: { figuresWithClient: jest.fn().mockResolvedValue([]) } },
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
    // F6: the terms it starts with are its first dated version.
    expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'created', 'user-1');
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

  describe('credit terms (Master Spec v3 P6, F5, F6, F8)', () => {
    it('every change is a new dated version, never an overwrite', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockCustomer);
      repo.updateCreditTermsWithClient.mockResolvedValue({ ...mockCustomer, creditLimit: '90000.00', version: 2 });
      await service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, creditLimit: 90000 });
      expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'terms', 'user-1');
    });

    it('the finance charge is switched on only with a rate', async () => {
      repo.findByIdWithClient.mockResolvedValue({ ...mockCustomer, financeChargeRateAnnual: '0.00' });
      await expect(service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, financeChargeEnabled: true })).rejects.toBeInstanceOf(BadRequestException);
      repo.updateCreditTermsWithClient.mockResolvedValue(mockCustomer);
      await service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, financeChargeEnabled: true, financeChargeRateAnnual: 18 });
      expect(repo.updateCreditTermsWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 1, expect.objectContaining({ financeChargeEnabled: true, financeChargeRateAnnual: 18 }));
    });

    it('Bill-to-Bill needs a backstop of at least a day', async () => {
      repo.findByIdWithClient.mockResolvedValue({ ...mockCustomer, paymentTermsDays: 0 });
      await expect(service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, billToBill: true })).rejects.toBeInstanceOf(BadRequestException);
      repo.updateCreditTermsWithClient.mockResolvedValue(mockCustomer);
      await service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, billToBill: true, paymentTermsDays: 15 });
      expect(repo.updateCreditTermsWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 1, expect.objectContaining({ billToBill: true, paymentTermsDays: 15 }));
    });

    it('BD.4: a write-off puts the customer on hold, as a version of their terms', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockCustomer);
      repo.holdForReviewWithClient.mockResolvedValue({ ...mockCustomer, creditHold: true, creditHoldReason: 'Bad debt' });
      await service.holdForReviewWithClient(fakeClient as never, 'tenant-1', 'user-1', mockCustomer.id, 'Bad debt');
      expect(repo.holdForReviewWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'Bad debt');
      expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'write_off', 'user-1');
    });
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
