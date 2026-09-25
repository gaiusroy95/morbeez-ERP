import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DelegationsService } from './delegations.service';
import { ApprovalDelegationsRepository } from './repositories/approval-delegations.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { UsersService } from '../users/users.service';
import { ApprovalDelegationRecord } from './entities/approval.entity';

const fakeClient = {} as PoolClient;

const mockDelegation: ApprovalDelegationRecord = {
  id: 'delegation-1',
  tenantId: 'tenant-1',
  roleId: 'owner-role',
  delegatorUserId: 'owner-1',
  delegateUserId: 'stand-in-1',
  startsAt: new Date(),
  endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
  revokedAt: null,
  createdAt: new Date(),
  createdBy: 'owner-1',
};

describe('DelegationsService', () => {
  let service: DelegationsService;
  let repo: jest.Mocked<ApprovalDelegationsRepository>;
  let usersService: jest.Mocked<UsersService>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DelegationsService,
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        {
          provide: ApprovalDelegationsRepository,
          useValue: {
            list: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            revokeWithClient: jest.fn(),
          },
        },
        { provide: UsersService, useValue: { getRoleIdsForUserWithClient: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(DelegationsService);
    repo = module.get(ApprovalDelegationsRepository);
    usersService = module.get(UsersService);
    audit = module.get(AuditService);
  });

  describe('create()', () => {
    it('refuses to delegate a role the caller does not hold directly', async () => {
      usersService.getRoleIdsForUserWithClient.mockResolvedValue(['some-other-role']);

      await expect(
        service.create('tenant-1', 'owner-1', {
          roleId: 'owner-role',
          delegateUserId: 'stand-in-1',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.createWithClient).not.toHaveBeenCalled();
    });

    it('refuses an end date that is not after the start date', async () => {
      usersService.getRoleIdsForUserWithClient.mockResolvedValue(['owner-role']);
      const now = new Date();

      await expect(
        service.create('tenant-1', 'owner-1', {
          roleId: 'owner-role',
          delegateUserId: 'stand-in-1',
          startsAt: now.toISOString(),
          endsAt: now.toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates and audits a valid delegation of a role the caller holds', async () => {
      usersService.getRoleIdsForUserWithClient.mockResolvedValue(['owner-role']);
      repo.createWithClient.mockResolvedValue(mockDelegation);

      const result = await service.create('tenant-1', 'owner-1', {
        roleId: 'owner-role',
        delegateUserId: 'stand-in-1',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(result).toEqual(mockDelegation);
      expect(audit.record).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ action: 'create', entityType: 'approval_delegation' }),
      );
    });
  });

  describe('revoke()', () => {
    it('lets the original delegator revoke their own delegation', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockDelegation);
      repo.revokeWithClient.mockResolvedValue({ ...mockDelegation, revokedAt: new Date() });

      await expect(
        service.revoke('tenant-1', 'owner-1', false, 'delegation-1'),
      ).resolves.not.toThrow();
    });

    it('lets an approvals:manage holder revoke someone else\'s delegation', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockDelegation);
      repo.revokeWithClient.mockResolvedValue({ ...mockDelegation, revokedAt: new Date() });

      await expect(
        service.revoke('tenant-1', 'admin-1', true, 'delegation-1'),
      ).resolves.not.toThrow();
    });

    it('refuses an unrelated user with no approvals:manage permission', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockDelegation);

      await expect(
        service.revoke('tenant-1', 'random-user', false, 'delegation-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.revokeWithClient).not.toHaveBeenCalled();
    });
  });
});
