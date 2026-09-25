import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { FarmersService } from './farmers.service';
import { FarmersRepository } from './repositories/farmers.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { FarmerRecord } from './entities/farmer.entity';

const mockFarmer: FarmerRecord = {
  id: 'farmer-1',
  tenantId: 'tenant-1',
  name: 'Test Farm',
  contact: {},
  bankDetails: { accountHolderName: 'Test Farm', accountNumber: '123456789', ifscCode: 'ABCD0123456' },
  reliabilityRating: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const fakeClient = {} as PoolClient;

describe('FarmersService', () => {
  let service: FarmersService;
  let repo: jest.Mocked<FarmersRepository>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmersService,
        {
          provide: FarmersRepository,
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

    service = module.get(FarmersService);
    repo = module.get(FarmersRepository);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('never writes plaintext bank details into the audit log, even though the entity carries them', async () => {
    repo.createWithClient.mockResolvedValue(mockFarmer);

    await service.create('tenant-1', 'user-1', { name: 'Test Farm' });

    const auditCall = audit.record.mock.calls[0][1];
    expect(auditCall.after).not.toEqual(expect.objectContaining({ bankDetails: mockFarmer.bankDetails }));
    expect((auditCall.after as Record<string, unknown>).bankDetails).toBe('[redacted]');
  });

  it('records "[redacted]" as null when there are no bank details on file at all, not the string', async () => {
    const farmerWithoutBank = { ...mockFarmer, bankDetails: null };
    repo.createWithClient.mockResolvedValue(farmerWithoutBank);

    await service.create('tenant-1', 'user-1', { name: 'Test Farm' });

    const auditCall = audit.record.mock.calls[0][1];
    expect((auditCall.after as Record<string, unknown>).bankDetails).toBeNull();
  });

  it('update() audits both before and after states, both redacted', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockFarmer);
    repo.updateWithClient.mockResolvedValue({ ...mockFarmer, name: 'Renamed Farm', version: 2 });

    await service.update('tenant-1', 'user-1', 'farmer-1', { version: 1, name: 'Renamed Farm' });

    const auditCall = audit.record.mock.calls[0][1];
    expect((auditCall.before as Record<string, unknown>).bankDetails).toBe('[redacted]');
    expect((auditCall.after as Record<string, unknown>).bankDetails).toBe('[redacted]');
  });
});
