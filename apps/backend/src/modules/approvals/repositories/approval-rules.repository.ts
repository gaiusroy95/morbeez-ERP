import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { ApprovalRuleRecord } from '../entities/approval.entity';

interface ApprovalRuleRow {
  id: string;
  tenant_id: string;
  action_type: string;
  threshold_amount: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: ApprovalRuleRow): ApprovalRuleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actionType: row.action_type,
    thresholdAmount: row.threshold_amount,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class ApprovalRulesRepository {
  constructor(private readonly db: DatabaseService) {}

  list(tenantId: string): Promise<ApprovalRuleRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<ApprovalRuleRow>(
        'SELECT * FROM approvals.approval_rule ORDER BY action_type',
      );
      return result.rows.map(toRecord);
    });
  }

  findByActionType(tenantId: string, actionType: string): Promise<ApprovalRuleRecord | null> {
    return this.db.withTenant(tenantId, (client) =>
      this.findByActionTypeWithClient(client, actionType),
    );
  }

  async findByActionTypeWithClient(
    client: PoolClient,
    actionType: string,
  ): Promise<ApprovalRuleRecord | null> {
    const result = await client.query<ApprovalRuleRow>(
      'SELECT * FROM approvals.approval_rule WHERE action_type = $1',
      [actionType],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** Upsert by (tenant_id, action_type) — a rule is config, not a historical record; there's nothing to version-conflict over. */
  async upsertWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: { actionType: string; thresholdAmount: number; isActive: boolean },
  ): Promise<ApprovalRuleRecord> {
    const result = await client.query<ApprovalRuleRow>(
      `INSERT INTO approvals.approval_rule (tenant_id, action_type, threshold_amount, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, action_type) DO UPDATE SET
         threshold_amount = EXCLUDED.threshold_amount,
         is_active = EXCLUDED.is_active,
         updated_at = now()
       RETURNING *`,
      [tenantId, fields.actionType, fields.thresholdAmount, fields.isActive, createdBy],
    );
    return toRecord(result.rows[0]);
  }
}
