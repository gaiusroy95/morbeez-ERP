import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { ApprovalRoleLimitRecord } from '../entities/approval.entity';

interface LimitRow {
  id: string;
  tenant_id: string;
  role_id: string;
  action_type: string | null;
  max_amount: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: LimitRow): ApprovalRoleLimitRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleId: row.role_id,
    actionType: row.action_type,
    maxAmount: row.max_amount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class ApprovalLimitsRepository {
  constructor(private readonly db: DatabaseService) {}

  list(tenantId: string): Promise<ApprovalRoleLimitRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<LimitRow>(
        `SELECT * FROM approvals.approval_role_limit ORDER BY action_type NULLS LAST`,
      );
      return result.rows.map(toRecord);
    });
  }

  /**
   * The specific (role, actionType) row if one exists, otherwise the
   * role's wildcard (action_type IS NULL) row, otherwise nothing — the
   * two-row-shape resolution the whole authorization check depends on.
   * `undefined` here means "this role has no limit configured for this
   * action type at all," distinct from a row whose max_amount is NULL
   * (unlimited).
   */
  async findEffectiveLimitWithClient(
    client: PoolClient,
    roleId: string,
    actionType: string,
  ): Promise<ApprovalRoleLimitRecord | undefined> {
    const result = await client.query<LimitRow>(
      `SELECT * FROM approvals.approval_role_limit
       WHERE role_id = $1 AND (action_type = $2 OR action_type IS NULL)
       ORDER BY action_type NULLS LAST
       LIMIT 1`,
      [roleId, actionType],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async upsertWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: { roleId: string; actionType: string | null; maxAmount: number | null },
  ): Promise<ApprovalRoleLimitRecord> {
    // Two separate ON CONFLICT targets (the two partial unique indexes
    // from the migration) — Postgres can't express "conflict on either
    // of these two indexes" in one statement, so the specific-vs-wildcard
    // case is a plain branch instead.
    const conflictTarget = fields.actionType
      ? '(tenant_id, role_id, action_type) WHERE action_type IS NOT NULL'
      : '(tenant_id, role_id) WHERE action_type IS NULL';

    const result = await client.query<LimitRow>(
      `INSERT INTO approvals.approval_role_limit (tenant_id, role_id, action_type, max_amount, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ${conflictTarget} DO UPDATE SET
         max_amount = EXCLUDED.max_amount,
         updated_at = now()
       RETURNING *`,
      [tenantId, fields.roleId, fields.actionType, fields.maxAmount, createdBy],
    );
    return toRecord(result.rows[0]);
  }
}
