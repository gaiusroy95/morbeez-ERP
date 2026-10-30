import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ActivityEntry, RoleSummary, TeamMember, TeamRepository } from './repositories/team.repository';

/**
 * Users & permissions and My Profile (owner app redesign Phase 7): the
 * business's logins with their roles, the roles and what each allows, and
 * what someone did lately.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: DatabaseService,
    private readonly team: TeamRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<TeamMember[]> {
    return this.db.withTenant(tenantId, (client) => this.team.teamWithClient(client));
  }

  roles(tenantId: string): Promise<RoleSummary[]> {
    return this.db.withTenant(tenantId, (client) => this.team.rolesWithClient(client));
  }

  /** Never your own: a slip here could take away the very access needed to put it back. */
  async removeRole(tenantId: string, actorUserId: string, userId: string, roleId: string): Promise<{ ok: true }> {
    if (userId === actorUserId) throw new BadRequestException("You can't take a role off yourself — ask another owner");
    await this.db.withTenant(tenantId, async (client) => {
      if (!(await this.team.removeRoleWithClient(client, userId, roleId))) throw new NotFoundException('User or role not found');
      await this.audit.record(client, { tenantId, actorUserId, action: 'update', entityType: 'user_role', entityId: userId, before: { roleId }, after: null });
    });
    return { ok: true };
  }

  activity(tenantId: string, userId: string, limit = 50): Promise<ActivityEntry[]> {
    return this.db.withTenant(tenantId, (client) => this.team.activityWithClient(client, userId, Math.min(Math.max(limit, 1), 200)));
  }
}
