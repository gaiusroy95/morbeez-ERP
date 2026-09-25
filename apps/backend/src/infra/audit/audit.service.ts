import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export type AuditAction = 'create' | 'update' | 'archive' | 'restore';

export interface AuditEntry {
  tenantId: string;
  actorUserId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// Every master-data mutation writes one of these, in the SAME transaction
// as the change it describes (Constitution V.5) — callers pass the open
// client from their own db.withTenant()/transaction() block, never let
// this open a second one. An audit row that could exist without the
// change it describes (or vice versa) isn't trustworthy; atomicity is the
// whole point.
@Injectable()
export class AuditService {
  async record(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO infra.audit_log
         (tenant_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.tenantId,
        entry.actorUserId,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
      ],
    );
  }
}
