import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { UsersService } from '../users/users.service';
import { ApprovalDelegationsRepository } from './repositories/approval-delegations.repository';
import { ApprovalDelegationRecord } from './entities/approval.entity';
import { CreateDelegationDto } from './dto/create-delegation.dto';

const ENTITY_TYPE = 'approval_delegation';

@Injectable()
export class DelegationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly delegations: ApprovalDelegationsRepository,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<ApprovalDelegationRecord[]> {
    return this.delegations.list(tenantId);
  }

  /**
   * You can only delegate a role you hold directly — never a role you
   * merely hold via someone else's delegation to you. That would turn
   * this into an unbounded chain with no clear point of accountability,
   * which is exactly what the 180-day window and the single-hop rule
   * together are meant to prevent.
   */
  async create(
    tenantId: string,
    delegatorUserId: string,
    dto: CreateDelegationDto,
  ): Promise<ApprovalDelegationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const heldDirectly = await this.users.getRoleIdsForUserWithClient(client, delegatorUserId);
      if (!heldDirectly.includes(dto.roleId)) {
        throw new ForbiddenException('You can only delegate a role you hold directly');
      }

      const startsAt = new Date(dto.startsAt);
      const endsAt = new Date(dto.endsAt);
      if (endsAt <= startsAt) {
        throw new BadRequestException('endsAt must be after startsAt');
      }

      const delegation = await this.delegations.createWithClient(client, tenantId, delegatorUserId, {
        roleId: dto.roleId,
        delegatorUserId,
        delegateUserId: dto.delegateUserId,
        startsAt,
        endsAt,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId: delegatorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: delegation.id,
        after: delegation as unknown as Record<string, unknown>,
      });

      return delegation;
    });
  }

  async revoke(
    tenantId: string,
    actorUserId: string,
    isApprovalsManager: boolean,
    id: string,
  ): Promise<ApprovalDelegationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.delegations.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Delegation not found');

      // The delegator can always revoke their own delegation; anyone else
      // needs approvals:manage (e.g. an Owner cleaning up after someone's
      // departure) — checked here, with the caller's permission passed in
      // from the controller's AuthContext, since the service has no other
      // way to see it.
      if (before.delegatorUserId !== actorUserId && !isApprovalsManager) {
        throw new ForbiddenException(
          'Only the delegator, or someone with approvals:manage, can revoke this delegation',
        );
      }

      const after = await this.delegations.revokeWithClient(client, id);
      if (!after) throw new NotFoundException('Delegation not found or already revoked');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });

      return after;
    });
  }
}
