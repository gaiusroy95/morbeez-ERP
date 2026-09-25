import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { ApprovalDelegationRecord } from '../entities/approval.entity';

interface DelegationRow {
  id: string;
  tenant_id: string;
  role_id: string;
  delegator_user_id: string;
  delegate_user_id: string;
  starts_at: Date;
  ends_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  created_by: string;
}

function toRecord(row: DelegationRow): ApprovalDelegationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    delegatorUserId: row.delegator_user_id,
    delegateUserId: row.delegate_user_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class ApprovalDelegationsRepository {
  constructor(private readonly db: DatabaseService) {}

  list(tenantId: string): Promise<ApprovalDelegationRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<DelegationRow>(
        'SELECT * FROM approvals.approval_delegation ORDER BY starts_at DESC',
      );
      return result.rows.map(toRecord);
    });
  }

  findById(tenantId: string, id: string): Promise<ApprovalDelegationRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<ApprovalDelegationRecord | null> {
    const result = await client.query<DelegationRow>(
      'SELECT * FROM approvals.approval_delegation WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /**
   * Every currently-active delegation (window open, not revoked) that
   * grants `userId` a role — the set ApprovalsService unions with the
   * user's directly-held roles when resolving who can approve something.
   */
  async findActiveForDelegateWithClient(
    client: PoolClient,
    delegateUserId: string,
  ): Promise<ApprovalDelegationRecord[]> {
    const result = await client.query<DelegationRow>(
      `SELECT * FROM approvals.approval_delegation
       WHERE delegate_user_id = $1
         AND revoked_at IS NULL
         AND starts_at <= now()
         AND ends_at >= now()`,
      [delegateUserId],
    );
    return result.rows.map(toRecord);
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: { roleId: string; delegatorUserId: string; delegateUserId: string; startsAt: Date; endsAt: Date },
  ): Promise<ApprovalDelegationRecord> {
    const result = await client.query<DelegationRow>(
      `INSERT INTO approvals.approval_delegation
         (tenant_id, role_id, delegator_user_id, delegate_user_id, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        fields.roleId,
        fields.delegatorUserId,
        fields.delegateUserId,
        fields.startsAt,
        fields.endsAt,
        createdBy,
      ],
    );
    return toRecord(result.rows[0]);
  }

  async revokeWithClient(client: PoolClient, id: string): Promise<ApprovalDelegationRecord | null> {
    const result = await client.query<DelegationRow>(
      `UPDATE approvals.approval_delegation SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
