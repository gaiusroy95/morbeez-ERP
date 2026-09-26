import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { PurchaseOrderLineRecord, PurchaseOrderRecord, PurchaseOrderStatus } from '../entities/purchase-order.entity';

interface PurchaseOrderRow {
  id: string;
  tenant_id: string;
  farmer_id: string;
  status: PurchaseOrderStatus;
  expected_delivery_date: string | null;
  approval_request_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

interface PurchaseOrderLineRow {
  id: string;
  purchase_order_id: string;
  product_id: string;
  expected_quantity: string;
  indicative_price: string;
}

function toRecord(row: PurchaseOrderRow, lines?: PurchaseOrderLineRow[]): PurchaseOrderRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    farmerId: row.farmer_id,
    status: row.status,
    expectedDeliveryDate: row.expected_delivery_date,
    approvalRequestId: row.approval_request_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    lines: lines?.map(toLineRecord),
  };
}

function toLineRecord(row: PurchaseOrderLineRow): PurchaseOrderLineRecord {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    expectedQuantity: row.expected_quantity,
    indicativePrice: row.indicative_price,
  };
}

@Injectable()
export class PurchaseOrdersRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    status: PurchaseOrderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<PurchaseOrderRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<PurchaseOrderRow>(
          `SELECT * FROM commerce.purchase_order
           WHERE ($3::text IS NULL OR status = $3)
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [size, offset, status ?? null],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) FROM commerce.purchase_order WHERE ($1::text IS NULL OR status = $1)`,
          [status ?? null],
        ),
      ]);
      return {
        items: rows.rows.map((r) => toRecord(r)),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<PurchaseOrderRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<PurchaseOrderRecord | null> {
    const result = await client.query<PurchaseOrderRow>(
      'SELECT * FROM commerce.purchase_order WHERE id = $1',
      [id],
    );
    if (!result.rows[0]) return null;

    const lines = await client.query<PurchaseOrderLineRow>(
      'SELECT * FROM commerce.purchase_order_line WHERE purchase_order_id = $1 ORDER BY created_at',
      [id],
    );
    return toRecord(result.rows[0], lines.rows);
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      farmerId: string;
      lines: { productId: string; expectedQuantity: number; indicativePrice: number }[];
    },
  ): Promise<PurchaseOrderRecord> {
    const poResult = await client.query<PurchaseOrderRow>(
      `INSERT INTO commerce.purchase_order (tenant_id, farmer_id, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tenantId, fields.farmerId, createdBy],
    );
    const po = poResult.rows[0];

    const lineRows: PurchaseOrderLineRow[] = [];
    for (const line of fields.lines) {
      const lineResult = await client.query<PurchaseOrderLineRow>(
        `INSERT INTO commerce.purchase_order_line (purchase_order_id, product_id, expected_quantity, indicative_price)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [po.id, line.productId, line.expectedQuantity, line.indicativePrice],
      );
      lineRows.push(lineResult.rows[0]);
    }

    return toRecord(po, lineRows);
  }

  /** The order's estimated value at ordering time — what Approvals evaluates against, computed from indicative prices, never lot.unit_cost (which doesn't exist yet at confirmation time). */
  async computeEstimatedValueWithClient(client: PoolClient, purchaseOrderId: string): Promise<number> {
    const result = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(expected_quantity * indicative_price), 0) AS total
       FROM commerce.purchase_order_line WHERE purchase_order_id = $1`,
      [purchaseOrderId],
    );
    return Number(result.rows[0].total);
  }

  async setApprovalRequestWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    approvalRequestId: string,
  ): Promise<PurchaseOrderRecord> {
    return this.updateStatusWithClient(client, id, expectedVersion, {
      approvalRequestId,
    });
  }

  async confirmWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    expectedDeliveryDate: string | null,
  ): Promise<PurchaseOrderRecord> {
    return this.updateStatusWithClient(client, id, expectedVersion, {
      status: 'confirmed',
      expectedDeliveryDate,
      requireCurrentStatus: 'placed',
    });
  }

  async cancelWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<PurchaseOrderRecord> {
    const result = await client.query<PurchaseOrderRow>(
      `UPDATE commerce.purchase_order SET status = 'cancelled', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status IN ('placed', 'confirmed')
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('PurchaseOrder', id);
    return toRecord(result.rows[0]);
  }

  async markReceivedWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<PurchaseOrderRecord> {
    return this.updateStatusWithClient(client, id, expectedVersion, {
      status: 'received',
      requireCurrentStatus: 'confirmed',
    });
  }

  async markGradedWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<PurchaseOrderRecord> {
    return this.updateStatusWithClient(client, id, expectedVersion, {
      status: 'graded',
      requireCurrentStatus: 'received',
    });
  }

  async closeWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<PurchaseOrderRecord> {
    return this.updateStatusWithClient(client, id, expectedVersion, {
      status: 'closed',
      requireCurrentStatus: 'graded',
    });
  }

  private async updateStatusWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    fields: {
      status?: PurchaseOrderStatus;
      expectedDeliveryDate?: string | null;
      approvalRequestId?: string;
      requireCurrentStatus?: PurchaseOrderStatus;
    },
  ): Promise<PurchaseOrderRecord> {
    const result = await client.query<PurchaseOrderRow>(
      `UPDATE commerce.purchase_order SET
         status = COALESCE($3, status),
         expected_delivery_date = COALESCE($4, expected_delivery_date),
         approval_request_id = COALESCE($5, approval_request_id),
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2
         AND ($6::text IS NULL OR status = $6)
       RETURNING *`,
      [
        id,
        expectedVersion,
        fields.status ?? null,
        fields.expectedDeliveryDate ?? null,
        fields.approvalRequestId ?? null,
        fields.requireCurrentStatus ?? null,
      ],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('PurchaseOrder', id);
    return toRecord(result.rows[0]);
  }
}
