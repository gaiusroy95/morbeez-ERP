import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ApprovalsService } from './approvals.service';
import { ApprovalRulesRepository } from './repositories/approval-rules.repository';
import { ApprovalLimitsRepository } from './repositories/approval-limits.repository';
import { ApprovalRequestsRepository } from './repositories/approval-requests.repository';
import { ApprovalDelegationsRepository } from './repositories/approval-delegations.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { UsersService } from '../users/users.service';
import { ApprovalRequestRecord, ApprovalRuleRecord } from './entities/approval.entity';

const fakeClient = {} as PoolClient;

const mockRule: ApprovalRuleRecord = {
  id: 'rule-1',
  tenantId: 'tenant-1',
  actionType: 'purchase_order',
  thresholdAmount: '50000.00',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'owner-1',
};

const mockRequest: ApprovalRequestRecord = {
  id: 'request-1',
  tenantId: 'tenant-1',
  actionType: 'purchase_order',
  subjectId: 'po-1',
  amount: '75000.00',
  status: 'pending',
  requestedBy: 'requester-1',
  decidedBy: null,
  decidedViaRoleId: null,
  decidedViaDelegationId: null,
  decisionNote: null,
  decidedAt: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let rulesRepo: jest.Mocked<ApprovalRulesRepository>;
  let limitsRepo: jest.Mocked<ApprovalLimitsRepository>;
  let requestsRepo: jest.Mocked<ApprovalRequestsRepository>;
  let delegationsRepo: jest.Mocked<ApprovalDelegationsRepository>;
  let usersService: jest.Mocked<UsersService>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        {
          provide: ApprovalRulesRepository,
          useValue: { findByActionTypeWithClient: jest.fn(), list: jest.fn(), upsertWithClient: jest.fn() },
        },
        {
          provide: ApprovalLimitsRepository,
          useValue: { findEffectiveLimitWithClient: jest.fn(), list: jest.fn(), upsertWithClient: jest.fn() },
        },
        {
          provide: ApprovalRequestsRepository,
          useValue: {
            createWithClient: jest.fn(),
            findByIdWithClient: jest.fn(),
            decideWithClient: jest.fn(),
            cancelWithClient: jest.fn(),
            list: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: ApprovalDelegationsRepository,
          useValue: { findActiveForDelegateWithClient: jest.fn() },
        },
        { provide: UsersService, useValue: { getRoleIdsForUserWithClient: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(ApprovalsService);
    rulesRepo = module.get(ApprovalRulesRepository);
    limitsRepo = module.get(ApprovalLimitsRepository);
    requestsRepo = module.get(ApprovalRequestsRepository);
    delegationsRepo = module.get(ApprovalDelegationsRepository);
    usersService = module.get(UsersService);
    audit = module.get(AuditService);
  });

  describe('evaluate()', () => {
    it('requires nothing when no rule exists for the action type', async () => {
      rulesRepo.findByActionTypeWithClient.mockResolvedValue(null);

      const result = await service.evaluate('tenant-1', 'requester-1', {
        actionType: 'purchase_order',
        subjectId: 'po-1',
        amount: 999999,
      });

      expect(result).toEqual({ required: false });
      expect(requestsRepo.createWithClient).not.toHaveBeenCalled();
    });

    it('requires nothing when the amount is below the rule threshold', async () => {
      rulesRepo.findByActionTypeWithClient.mockResolvedValue(mockRule);

      const result = await service.evaluate('tenant-1', 'requester-1', {
        actionType: 'purchase_order',
        subjectId: 'po-1',
        amount: 100,
      });

      expect(result).toEqual({ required: false });
    });

    it('requires nothing when the rule is inactive, even above threshold', async () => {
      rulesRepo.findByActionTypeWithClient.mockResolvedValue({ ...mockRule, isActive: false });

      const result = await service.evaluate('tenant-1', 'requester-1', {
        actionType: 'purchase_order',
        subjectId: 'po-1',
        amount: 999999,
      });

      expect(result).toEqual({ required: false });
    });

    it('creates a pending request and audits it when at or above threshold', async () => {
      rulesRepo.findByActionTypeWithClient.mockResolvedValue(mockRule);
      requestsRepo.createWithClient.mockResolvedValue(mockRequest);

      const result = await service.evaluate('tenant-1', 'requester-1', {
        actionType: 'purchase_order',
        subjectId: 'po-1',
        amount: 75000,
      });

      expect(result).toEqual({ required: true, request: mockRequest });
      expect(audit.record).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ action: 'create', entityType: 'approval_request' }),
      );
    });
  });

  describe('decide()', () => {
    it('refuses to let the original requester decide their own request', async () => {
      requestsRepo.findByIdWithClient.mockResolvedValue(mockRequest);

      await expect(
        service.decide('tenant-1', 'requester-1', 'request-1', 1, true),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.decideWithClient).not.toHaveBeenCalled();
    });

    it('refuses to decide a request that is no longer pending', async () => {
      requestsRepo.findByIdWithClient.mockResolvedValue({ ...mockRequest, status: 'approved' });

      await expect(
        service.decide('tenant-1', 'someone-else', 'request-1', 1, true),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a decider with no direct role and no active delegation that authorizes this amount', async () => {
      requestsRepo.findByIdWithClient.mockResolvedValue(mockRequest);
      usersService.getRoleIdsForUserWithClient.mockResolvedValue([]);
      delegationsRepo.findActiveForDelegateWithClient.mockResolvedValue([]);

      await expect(
        service.decide('tenant-1', 'decider-1', 'request-1', 1, true),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a decider whose role limit is below the requested amount', async () => {
      requestsRepo.findByIdWithClient.mockResolvedValue(mockRequest); // amount 75000
      usersService.getRoleIdsForUserWithClient.mockResolvedValue(['accountant-role']);
      limitsRepo.findEffectiveLimitWithClient.mockResolvedValue({
        id: 'limit-1',
        tenantId: 'tenant-1',
        roleId: 'accountant-role',
        actionType: 'purchase_order',
        maxAmount: '25000.00', // below the request's 75000
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'owner-1',
      });
      delegationsRepo.findActiveForDelegateWithClient.mockResolvedValue([]);

      await expect(
        service.decide('tenant-1', 'decider-1', 'request-1', 1, true),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('approves via a direct role whose limit covers the amount, recording no delegation', async () => {
      requestsRepo.findByIdWithClient.mockResolvedValue(mockRequest);
      usersService.getRoleIdsForUserWithClient.mockResolvedValue(['ops-manager-role']);
      limitsRepo.findEffectiveLimitWithClient.mockResolvedValue({
        id: 'limit-2',
        tenantId: 'tenant-1',
        roleId: 'ops-manager-role',
        actionType: 'purchase_order',
        maxAmount: '100000.00',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'owner-1',
      });
      requestsRepo.decideWithClient.mockResolvedValue({ ...mockRequest, status: 'approved', version: 2 });

      await service.decide('tenant-1', 'ops-manager-1', 'request-1', 1, true, 'looks fine');

      expect(requestsRepo.decideWithClient).toHaveBeenCalledWith(
        fakeClient,
        'request-1',
        1,
        expect.objectContaining({
          status: 'approved',
          decidedViaRoleId: 'ops-manager-role',
          decidedViaDelegationId: null,
        }),
      );
    });

    it('approves via an active delegation when the decider holds no sufficient direct role', async () => {
      requestsRepo.findByIdWithClient.mockResolvedValue(mockRequest);
      usersService.getRoleIdsForUserWithClient.mockResolvedValue([]); // no direct roles at all
      delegationsRepo.findActiveForDelegateWithClient.mockResolvedValue([
        {
          id: 'delegation-1',
          tenantId: 'tenant-1',
          roleId: 'owner-role',
          delegatorUserId: 'owner-1',
          delegateUserId: 'stand-in-1',
          startsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 1000 * 60 * 60),
          revokedAt: null,
          createdAt: new Date(),
          createdBy: 'owner-1',
        },
      ]);
      limitsRepo.findEffectiveLimitWithClient.mockResolvedValue({
        id: 'limit-3',
        tenantId: 'tenant-1',
        roleId: 'owner-role',
        actionType: null, // wildcard — Owner's blanket limit
        maxAmount: null, // unlimited
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'owner-1',
      });
      requestsRepo.decideWithClient.mockResolvedValue({ ...mockRequest, status: 'approved', version: 2 });

      await service.decide('tenant-1', 'stand-in-1', 'request-1', 1, true);

      expect(requestsRepo.decideWithClient).toHaveBeenCalledWith(
        fakeClient,
        'request-1',
        1,
        expect.objectContaining({
          decidedViaRoleId: 'owner-role',
          decidedViaDelegationId: 'delegation-1',
        }),
      );
    });

    it('a non-monetary request (amount null) is authorized by the mere existence of a limit row', async () => {
      const nonMonetary = { ...mockRequest, amount: null };
      requestsRepo.findByIdWithClient.mockResolvedValue(nonMonetary);
      usersService.getRoleIdsForUserWithClient.mockResolvedValue(['accountant-role']);
      limitsRepo.findEffectiveLimitWithClient.mockResolvedValue({
        id: 'limit-4',
        tenantId: 'tenant-1',
        roleId: 'accountant-role',
        actionType: 'bad_debt_writeoff',
        maxAmount: '1000.00', // irrelevant — amount is null
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'owner-1',
      });
      requestsRepo.decideWithClient.mockResolvedValue({ ...nonMonetary, status: 'approved', version: 2 });

      await expect(
        service.decide('tenant-1', 'accountant-1', 'request-1', 1, true),
      ).resolves.not.toThrow();
    });
  });
});
