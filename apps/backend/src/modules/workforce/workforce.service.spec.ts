import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { WorkforceService } from './workforce.service';
import { EmployeesRepository } from './repositories/employees.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { EmployeeRecord } from './entities/employee.entity';

const mockEmployee: EmployeeRecord = {
  id: 'employee-1',
  tenantId: 'tenant-1',
  userId: null,
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

const fakeClient = {} as PoolClient;

describe('WorkforceService', () => {
  let service: WorkforceService;
  let repo: jest.Mocked<EmployeesRepository>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WorkforceService,
        {
          provide: EmployeesRepository,
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

    service = module.get(WorkforceService);
    repo = module.get(EmployeesRepository);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('create() works for an employee with no linked login (userId omitted)', async () => {
    repo.createWithClient.mockResolvedValue(mockEmployee);

    const result = await service.create('tenant-1', 'user-1', {
      name: 'Test Driver',
      roleType: 'driver',
    });

    expect(result.userId).toBeNull();
    expect(repo.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({ userId: undefined }),
    );
  });

  it('archive() and restore() are distinct, auditable actions', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockEmployee);
    repo.setStatusWithClient.mockResolvedValueOnce({ ...mockEmployee, status: 'archived' });

    await service.archive('tenant-1', 'user-1', 'employee-1');
    expect(audit.record).toHaveBeenLastCalledWith(
      fakeClient,
      expect.objectContaining({ action: 'archive' }),
    );

    repo.findByIdWithClient.mockResolvedValue({ ...mockEmployee, status: 'archived' });
    repo.setStatusWithClient.mockResolvedValueOnce({ ...mockEmployee, status: 'active' });

    await service.restore('tenant-1', 'user-1', 'employee-1');
    expect(audit.record).toHaveBeenLastCalledWith(
      fakeClient,
      expect.objectContaining({ action: 'restore' }),
    );
  });
});
