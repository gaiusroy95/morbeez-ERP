import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface TeamMember {
  userId: string;
  login: string;
  phone: string | null;
  email: string | null;
  status: 'active' | 'deactivated';
  roles: { id: string; name: string }[];
  /** The worker this login belongs to, when it's a worker's. */
  workerName: string | null;
  createdAt: Date;
}

export interface RoleSummary {
  id: string;
  name: string;
  permissions: string[];
  members: number;
}

export interface ActivityEntry {
  action: string;
  entityType: string;
  entityId: string;
  at: Date;
}

/**
 * Users & permissions and My Profile (owner app redesign Phase 7): who can
 * sign in to the business and with which roles, and what someone did
 * recently. Tenant-scoped by RLS on identity.app_user, identity.role and
 * infra.audit_log; identity.user_role has no tenant of its own and is only
 * ever reached through those.
 */
@Injectable()
export class TeamRepository {
  async teamWithClient(client: PoolClient): Promise<TeamMember[]> {
    const result = await client.query<{
      id: string; phone: string | null; email: string | null; status: 'active' | 'deactivated'; created_at: Date;
      roles: { id: string; name: string }[] | null; worker_name: string | null;
    }>(
      `SELECT u.id, u.phone, u.email, u.status, u.created_at,
              (SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
                 FROM identity.user_role ur JOIN identity.role r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
              (SELECT e.name FROM trading_partners.employee e WHERE e.user_id = u.id ORDER BY e.created_at LIMIT 1) AS worker_name
         FROM identity.app_user u
        ORDER BY u.status, u.created_at`,
    );
    return result.rows.map((r) => ({
      userId: r.id,
      login: r.phone ?? r.email ?? '',
      phone: r.phone,
      email: r.email,
      status: r.status,
      roles: r.roles ?? [],
      workerName: r.worker_name,
      createdAt: r.created_at,
    }));
  }

  async rolesWithClient(client: PoolClient): Promise<RoleSummary[]> {
    const result = await client.query<{ id: string; name: string; permissions: string[] | null; members: number }>(
      `SELECT r.id, r.name,
              (SELECT array_agg(p.code ORDER BY p.code) FROM identity.role_permission rp JOIN identity.permission p ON p.id = rp.permission_id
                WHERE rp.role_id = r.id) AS permissions,
              (SELECT count(*)::int FROM identity.user_role ur JOIN identity.app_user u ON u.id = ur.user_id WHERE ur.role_id = r.id) AS members
         FROM identity.role r ORDER BY r.name`,
    );
    return result.rows.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions ?? [], members: r.members }));
  }

  /** Takes a role off a user — both checked to be this business's first (RLS), as assignToUser does. */
  async removeRoleWithClient(client: PoolClient, userId: string, roleId: string): Promise<boolean> {
    const known = await client.query(
      'SELECT 1 FROM identity.app_user u, identity.role r WHERE u.id = $1 AND r.id = $2',
      [userId, roleId],
    );
    if (known.rowCount === 0) return false;
    await client.query('DELETE FROM identity.user_role WHERE user_id = $1 AND role_id = $2', [userId, roleId]);
    return true;
  }

  /** What this person did lately, newest first (from the audit trail). */
  async activityWithClient(client: PoolClient, userId: string, limit: number): Promise<ActivityEntry[]> {
    const result = await client.query<{ action: string; entity_type: string; entity_id: string; occurred_at: Date }>(
      `SELECT action, entity_type, entity_id, occurred_at FROM infra.audit_log
        WHERE actor_user_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((r) => ({ action: r.action, entityType: r.entity_type, entityId: r.entity_id, at: r.occurred_at }));
  }
}
