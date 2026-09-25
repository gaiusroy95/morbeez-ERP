import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { ApprovalRequestRecord, ApprovalRequestStatus } from '../entities/approval.entity';

interface RequestRow {
  id: string;
  tenant_id: string;
  action_type: string;
  subject_id: string;
  amount: string | null;
  status: ApprovalRequestStatus;
  requested_by: string;
  decided_by: string | null;
  decided_via_role_id: string | null;
  decided_via_delegation_id: string | null;
  decision_note: string | null;
  decided_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: RequestRow): ApprovalRequestRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actionType: row.action_type,
    subjectId: row.subject_id,
    amount: row.amount,
    status: row.status,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decidedViaRoleId: row.decided_via_role_id,
    decidedViaDelegationId: row.decided_via_delegation_id,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class ApprovalRequestsRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    status: ApprovalRequestStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApprovalRequestRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<RequestRow>(
          `SELECT * FROM approvals.approval_request
           WHERE ($3::text IS NULL OR status = $3)
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [size, offset, status ?? null],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) FROM approvals.approval_request WHERE ($1::text IS NULL OR status = $1)`,
          [status ?? null],
        ),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<ApprovalRequestRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<ApprovalRequestRecord | null> {
    const result = await client.query<RequestRow>(
      'SELECT * FROM approvals.approval_request WHERE id = $1',
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    requestedBy: string,
    fields: { actionType: string; subjectId: string; amount: number | null },
  ): Promise<ApprovalRequestRecord> {
    const result = await client.query<RequestRow>(
      `INSERT INTO approvals.approval_request (tenant_id, action_type, subject_id, amount, requested_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, fields.actionType, fields.subjectId, fields.amount, requestedBy],
    );
    return toRecord(result.rows[0]);
  }

  async decideWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: {
      status: 'approved' | 'rejected';
      decidedBy: string;
      decidedViaRoleId: string;
      decidedViaDelegationId: string | null;
      note?: string;
    },
  ): Promise<ApprovalRequestRecord> {
    const result = await client.query<RequestRow>(
      `UPDATE approvals.approval_request SET
         status = $3,
         decided_by = $4,
         decided_via_role_id = $5,
         decided_via_delegation_id = $6,
         decision_note = $7,
         decided_at = now(),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'pending'
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.status,
        fields.decidedBy,
        fields.decidedViaRoleId,
        fields.decidedViaDelegationId,
        fields.note ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('ApprovalRequest', id);
    }
    return toRecord(result.rows[0]);
  }

  async cancelWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<ApprovalRequestRecord> {
    const result = await client.query<RequestRow>(
      `UPDATE approvals.approval_request SET
         status = 'cancelled', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'pending'
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) {
      throw new OptimisticLockException('ApprovalRequest', id);
    }
    return toRecord(result.rows[0]);
  }
}
