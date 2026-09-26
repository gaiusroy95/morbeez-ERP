import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { OrderLineRecord, OrderRecord, OrderStatus } from '../entities/customer-order.entity';

interface OrderRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: OrderStatus;
  approval_request_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

interface OrderLineRow {
  id: string;
  order_id: string;
  product_id: string;
  quantity: string;
  unit_price: string;
}

function toRecord(row: OrderRow, lines?: OrderLineRow[]): OrderRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    status: row.status,
    approvalRequestId: row.approval_request_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    lines: lines?.map(toLineRecord),
  };
}

function toLineRecord(row: OrderLineRow): OrderLineRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
  };
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    status: OrderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<OrderRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<OrderRow>(
          `SELECT * FROM commerce.customer_order
           WHERE ($3::text IS NULL OR status = $3)
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [size, offset, status ?? null],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) FROM commerce.customer_order WHERE ($1::text IS NULL OR status = $1)`,
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

  findById(tenantId: string, id: string): Promise<OrderRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<OrderRecord | null> {
    const result = await client.query<OrderRow>('SELECT * FROM commerce.customer_order WHERE id = $1', [id]);
    if (!result.rows[0]) return null;

    const lines = await client.query<OrderLineRow>(
      'SELECT * FROM commerce.customer_order_line WHERE order_id = $1 ORDER BY created_at',
      [id],
    );
    return toRecord(result.rows[0], lines.rows);
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      customerId: string;
      lines: { productId: string; quantity: number; unitPrice: number }[];
    },
  ): Promise<OrderRecord> {
    const orderResult = await client.query<OrderRow>(
      `INSERT INTO commerce.customer_order (tenant_id, customer_id, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tenantId, fields.customerId, createdBy],
    );
    const order = orderResult.rows[0];

    const lineRows: OrderLineRow[] = [];
    for (const line of fields.lines) {
      const lineResult = await client.query<OrderLineRow>(
        `INSERT INTO commerce.customer_order_line (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [order.id, line.productId, line.quantity, line.unitPrice],
      );
      lineRows.push(lineResult.rows[0]);
    }

    return toRecord(order, lineRows);
  }

  /** What Approvals and the credit check both evaluate against — sum(quantity * unit_price) across this order's lines. */
  async computeTotalWithClient(client: PoolClient, orderId: string): Promise<number> {
    const result = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(quantity * unit_price), 0) AS total
       FROM commerce.customer_order_line WHERE order_id = $1`,
      [orderId],
    );
    return Number(result.rows[0].total);
  }

  /**
   * This customer's committed-but-not-yet-paid exposure: the total value
   * of every other 'confirmed' order. There is no Finance/AR ledger yet to
   * net off actual payments received, so this is a deliberate
   * approximation — once that module exists, the real accounts
   * receivable balance replaces this query, not the credit-check logic
   * that calls it.
   */
  async computeCustomerExposureWithClient(
    client: PoolClient,
    customerId: string,
    excludingOrderId: string,
  ): Promise<number> {
    const result = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(ol.quantity * ol.unit_price), 0) AS total
       FROM commerce.customer_order o
       JOIN commerce.customer_order_line ol ON ol.order_id = o.id
       WHERE o.customer_id = $1 AND o.status = 'confirmed' AND o.id <> $2`,
      [customerId, excludingOrderId],
    );
    return Number(result.rows[0].total);
  }

  async setApprovalRequestWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    approvalRequestId: string,
  ): Promise<OrderRecord> {
    const result = await client.query<OrderRow>(
      `UPDATE commerce.customer_order SET
         approval_request_id = $3,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'placed'
       RETURNING *`,
      [id, expectedVersion, approvalRequestId],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Order', id);
    return toRecord(result.rows[0]);
  }

  async confirmWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<OrderRecord> {
    const result = await client.query<OrderRow>(
      `UPDATE commerce.customer_order SET
         status = 'confirmed',
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'placed'
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Order', id);
    return toRecord(result.rows[0]);
  }

  async cancelWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<OrderRecord> {
    const result = await client.query<OrderRow>(
      `UPDATE commerce.customer_order SET status = 'cancelled', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status IN ('placed', 'confirmed')
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Order', id);
    return toRecord(result.rows[0]);
  }

  /** Called by Logistics when a Trip's delivery stop for this order completes (its public API, never this repository directly). */
  async deliverWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<OrderRecord> {
    const result = await client.query<OrderRow>(
      `UPDATE commerce.customer_order SET status = 'delivered', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'confirmed'
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Order', id);
    return toRecord(result.rows[0]);
  }
}
