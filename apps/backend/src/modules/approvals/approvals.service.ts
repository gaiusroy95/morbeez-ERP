import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { UsersService } from '../users/users.service';
import { ApprovalRulesRepository } from './repositories/approval-rules.repository';
import { ApprovalLimitsRepository } from './repositories/approval-limits.repository';
import { ApprovalRequestsRepository } from './repositories/approval-requests.repository';
import { ApprovalDelegationsRepository } from './repositories/approval-delegations.repository';
import {
  ApprovalEvaluation,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
  ApprovalRoleLimitRecord,
  ApprovalRuleRecord,
} from './entities/approval.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { UpsertApprovalRuleDto } from './dto/upsert-approval-rule.dto';
import { UpsertApprovalLimitDto } from './dto/upsert-approval-limit.dto';

interface ResolvedAuthority {
  roleId: string;
  delegationId: string | null;
}

const ENTITY_TYPE = 'approval_request';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rules: ApprovalRulesRepository,
    private readonly limits: ApprovalLimitsRepository,
    private readonly requests: ApprovalRequestsRepository,
    private readonly delegations: ApprovalDelegationsRepository,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  // ---- Rules ----

  listRules(tenantId: string): Promise<ApprovalRuleRecord[]> {
    return this.rules.list(tenantId);
  }

  upsertRule(
    tenantId: string,
    actorUserId: string,
    dto: UpsertApprovalRuleDto,
  ): Promise<ApprovalRuleRecord> {
    return this.db.withTenant(tenantId, (client) =>
      this.rules.upsertWithClient(client, tenantId, actorUserId, {
        actionType: dto.actionType,
        thresholdAmount: dto.thresholdAmount,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  // ---- Limits ----

  listLimits(tenantId: string): Promise<ApprovalRoleLimitRecord[]> {
    return this.limits.list(tenantId);
  }

  upsertLimit(
    tenantId: string,
    actorUserId: string,
    dto: UpsertApprovalLimitDto,
  ): Promise<ApprovalRoleLimitRecord> {
    return this.db.withTenant(tenantId, (client) =>
      this.limits.upsertWithClient(client, tenantId, actorUserId, {
        roleId: dto.roleId,
        actionType: dto.actionType ?? null,
        maxAmount: dto.maxAmount ?? null,
      }),
    );
  }

  // ---- Requests ----

  listRequests(
    tenantId: string,
    status: ApprovalRequestStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalRequestRecord>> {
    return this.requests.list(tenantId, status, page, pageSize);
  }

  async getRequest(tenantId: string, id: string): Promise<ApprovalRequestRecord> {
    const request = await this.requests.findById(tenantId, id);
    if (!request) throw new NotFoundException('Approval request not found');
    return request;
  }

  /**
   * The integration point every other module calls before proceeding with
   * an action that might need sign-off: "does this need approval, and if
   * so, here's the pending request." No rule for the action type, or a
   * rule whose threshold this amount doesn't reach, means the caller can
   * just proceed — {required: false} is not a maybe.
   */
  async evaluate(
    tenantId: string,
    requestedBy: string,
    fields: { actionType: string; subjectId: string; amount?: number },
  ): Promise<ApprovalEvaluation> {
    return this.db.withTenant(tenantId, async (client) => {
      const rule = await this.rules.findByActionTypeWithClient(client, fields.actionType);
      const amount = fields.amount ?? 0;

      if (!rule || !rule.isActive || amount < Number(rule.thresholdAmount)) {
        return { required: false };
      }

      const request = await this.requests.createWithClient(client, tenantId, requestedBy, {
        actionType: fields.actionType,
        subjectId: fields.subjectId,
        amount: fields.amount ?? null,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId: requestedBy,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: request.id,
        after: request as unknown as Record<string, unknown>,
      });

      return { required: true, request };
    });
  }

  async decide(
    tenantId: string,
    deciderUserId: string,
    requestId: string,
    expectedVersion: number,
    approved: boolean,
    note?: string,
  ): Promise<ApprovalRequestRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.requests.findByIdWithClient(client, requestId);
      if (!before) throw new NotFoundException('Approval request not found');
      if (before.status !== 'pending') {
        throw new ForbiddenException(`Request is already ${before.status}, not pending`);
      }

      // Checked before authorization resolution — a clearer error than
      // "no role authorizes you," and the actual backstop is the database
      // CHECK constraint (approval_request_decider_differs_from_requester)
      // regardless of what this service does (Constitution V.1, defense
      // in depth).
      if (before.requestedBy === deciderUserId) {
        throw new ForbiddenException('You cannot decide a request you filed yourself');
      }

      const authority = await this.resolveAuthority(
        client,
        deciderUserId,
        before.actionType,
        before.amount === null ? null : Number(before.amount),
      );
      if (!authority) {
        throw new ForbiddenException(
          `No role you hold (directly or via an active delegation) is authorized to approve ${before.actionType} at this amount`,
        );
      }

      const after = await this.requests.decideWithClient(client, requestId, expectedVersion, {
        status: approved ? 'approved' : 'rejected',
        decidedBy: deciderUserId,
        decidedViaRoleId: authority.roleId,
        decidedViaDelegationId: authority.delegationId,
        note,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId: deciderUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: requestId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });

      return after;
    });
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    requestId: string,
    expectedVersion: number,
  ): Promise<ApprovalRequestRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.requests.findByIdWithClient(client, requestId);
      if (!before) throw new NotFoundException('Approval request not found');
      if (before.requestedBy !== actorUserId) {
        throw new ForbiddenException('Only the person who requested approval can cancel it');
      }

      const after = await this.requests.cancelWithClient(client, requestId, expectedVersion);

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: requestId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });

      return after;
    });
  }

  /**
   * The authorization resolver: every role `userId` holds directly, plus
   * every role granted to them by a currently-active delegation, each
   * checked against the approval limit configured for (role, actionType).
   * Direct roles are tried first, purely so a decision's recorded
   * decidedViaDelegationId is null whenever a direct role would have
   * sufficed on its own — not a security distinction, a legibility one.
   */
  private async resolveAuthority(
    client: PoolClient,
    userId: string,
    actionType: string,
    amount: number | null,
  ): Promise<ResolvedAuthority | null> {
    const directRoleIds = await this.users.getRoleIdsForUserWithClient(client, userId);
    for (const roleId of directRoleIds) {
      if (await this.roleAuthorizes(client, roleId, actionType, amount)) {
        return { roleId, delegationId: null };
      }
    }

    const activeDelegations = await this.delegations.findActiveForDelegateWithClient(
      client,
      userId,
    );
    for (const delegation of activeDelegations) {
      if (await this.roleAuthorizes(client, delegation.roleId, actionType, amount)) {
        return { roleId: delegation.roleId, delegationId: delegation.id };
      }
    }

    return null;
  }

  private async roleAuthorizes(
    client: PoolClient,
    roleId: string,
    actionType: string,
    amount: number | null,
  ): Promise<boolean> {
    const limit = await this.limits.findEffectiveLimitWithClient(client, roleId, actionType);
    if (!limit) return false; // no limit configured for this role/action type at all
    if (limit.maxAmount === null) return true; // unlimited
    if (amount === null) return true; // non-monetary action; a configured limit is enough
    return amount <= Number(limit.maxAmount);
  }
}
