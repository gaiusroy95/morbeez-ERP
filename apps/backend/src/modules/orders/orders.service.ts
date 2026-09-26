import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { OptimisticLockException } from '../../common/persistence/optimistic-lock.exception';
import { ApprovalsService } from '../approvals/approvals.service';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { ProcurementService } from '../procurement/procurement.service';
import { OrdersRepository } from './repositories/orders.repository';
import { OrderRecord, OrderStatus } from './entities/customer-order.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateOrderDto } from './dto/create-order.dto';
import { VersionDto } from './dto/version.dto';

const ORDER_ENTITY = 'customer_order';

// A tenant configures its own threshold for this action type via the
// existing approval-rules API (POST /approval-rules) — unlike Procurement,
// nothing is seeded for it by default (Constitution III.6: seeds are
// dev-only and out of scope for this module).
const APPROVAL_ACTION_TYPE = 'customer_order';

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
    private readonly products: ProductsService,
    private readonly procurement: ProcurementService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  listOrders(
    tenantId: string,
    status: OrderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<OrderRecord>> {
    return this.orders.list(tenantId, status, page, pageSize);
  }

  async getOrder(tenantId: string, id: string): Promise<OrderRecord> {
    const order = await this.orders.findById(tenantId, id);
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Pricing: a line prices at the product's current basePrice unless the
   * caller supplies its own unitPrice (a negotiated rate for this order) —
   * either way the price is captured on the line at creation time and
   * never recomputed later, so a later basePrice change doesn't retroactively
   * reprice a standing order.
   */
  async createOrder(tenantId: string, actorUserId: string, dto: CreateOrderDto): Promise<OrderRecord> {
    const customer = await this.customers.getById(tenantId, dto.customerId);
    if (customer.status !== 'active') {
      throw new ConflictException('Cannot place an order for an archived customer');
    }

    const lines: { productId: string; quantity: number; unitPrice: number }[] = [];
    for (const line of dto.lines) {
      const product = await this.products.getById(tenantId, line.productId);
      if (product.status !== 'active') {
        throw new ConflictException(`Product '${product.name}' is archived and cannot be ordered`);
      }
      lines.push({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? Number(product.basePrice),
      });
    }

    return this.db.withTenant(tenantId, async (client) => {
      const order = await this.orders.createWithClient(client, tenantId, actorUserId, {
        customerId: dto.customerId,
        lines,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ORDER_ENTITY,
        entityId: order.id,
        after: order as unknown as Record<string, unknown>,
      });
      return order;
    });
  }

  /**
   * Credit check, then the approval gate, then (only once both clear)
   * stock reservation and the actual status flip to 'confirmed'. If an
   * approval is required, this call stops after setting
   * approval_request_id — reservation happens later, in
   * finalizeConfirmation, once the decision comes back approved.
   */
  async confirmOrder(tenantId: string, actorUserId: string, id: string, dto: VersionDto): Promise<OrderRecord> {
    const before = await this.getOrder(tenantId, id);
    if (before.status !== 'placed') {
      throw new ConflictException(`Cannot confirm an order in status '${before.status}'`);
    }
    if (before.approvalRequestId) {
      throw new ConflictException(
        'Already awaiting an approval decision — call finalize-confirmation once it is decided',
      );
    }
    if (dto.version !== before.version) {
      throw new OptimisticLockException('Order', id);
    }

    const orderTotal = await this.db.withTenant(tenantId, (client) => this.orders.computeTotalWithClient(client, id));

    await this.assertWithinCreditLimit(tenantId, before.customerId, id, orderTotal);

    const evaluation = await this.approvals.evaluate(tenantId, actorUserId, {
      actionType: APPROVAL_ACTION_TYPE,
      subjectId: id,
      amount: orderTotal,
    });

    if (evaluation.required) {
      return this.db.withTenant(tenantId, async (client) => {
        const after = await this.orders.setApprovalRequestWithClient(
          client,
          id,
          before.version,
          evaluation.request.id,
        );
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'update',
          entityType: ORDER_ENTITY,
          entityId: id,
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      });
    }

    return this.reserveAndConfirm(tenantId, actorUserId, before);
  }

  async finalizeConfirmation(tenantId: string, actorUserId: string, id: string): Promise<OrderRecord> {
    const before = await this.getOrder(tenantId, id);
    if (!before.approvalRequestId) {
      throw new BadRequestException('This order is not awaiting an approval decision');
    }
    if (before.status !== 'placed') {
      throw new ConflictException(`Cannot finalize confirmation from status '${before.status}'`);
    }

    const request = await this.approvals.getRequest(tenantId, before.approvalRequestId);
    if (request.status === 'pending') {
      throw new ConflictException('The approval decision is still pending');
    }

    if (request.status === 'approved') {
      return this.reserveAndConfirm(tenantId, actorUserId, before);
    }

    return this.db.withTenant(tenantId, async (client) => {
      const after = await this.orders.cancelWithClient(client, id, before.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ORDER_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * Cancelling a 'confirmed' order releases every lot its lines had
   * claimed before the cancellation itself is written — two separate
   * transactions (release, then cancel), the same eventual-consistency
   * window Procurement already accepts between Approvals.evaluate() and
   * its own confirm write. A 'placed' order never reserved anything, so
   * there is nothing to release.
   */
  async cancelOrder(tenantId: string, actorUserId: string, id: string, dto: VersionDto): Promise<OrderRecord> {
    const before = await this.getOrder(tenantId, id);

    if (before.status === 'confirmed') {
      for (const line of before.lines ?? []) {
        await this.procurement.releaseLotsForOrderLine(tenantId, actorUserId, line.id);
      }
    }

    return this.db.withTenant(tenantId, async (client) => {
      const after = await this.orders.cancelWithClient(client, id, dto.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ORDER_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * Called by Logistics — its public API, so Logistics never touches
   * OrdersRepository directly (Constitution I.3-I.4). No inventory or
   * accounting side effect yet; see the OrderStatus comment on 'delivered'.
   */
  markDelivered(tenantId: string, actorUserId: string, id: string, expectedVersion: number): Promise<OrderRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.orders.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Order not found');

      const after = await this.orders.deliverWithClient(client, id, expectedVersion);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ORDER_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * Credit check: this order's total plus every other 'confirmed' order's
   * total for the same customer must stay within their credit limit. A
   * hard block, not an approval-overridable gate — there is no Finance/AR
   * module yet to give a real-time balance an override could safely be
   * checked against, so the safest behavior is to refuse outright rather
   * than let a manager approve past a number nobody can fully verify yet.
   */
  private async assertWithinCreditLimit(
    tenantId: string,
    customerId: string,
    orderId: string,
    orderTotal: number,
  ): Promise<void> {
    const customer = await this.customers.getById(tenantId, customerId);
    const exposure = await this.db.withTenant(tenantId, (client) =>
      this.orders.computeCustomerExposureWithClient(client, customerId, orderId),
    );
    const creditLimit = Number(customer.creditLimit);

    if (exposure + orderTotal > creditLimit) {
      throw new ConflictException(
        `Confirming this order would exceed ${customer.name}'s credit limit ` +
          `(limit ${creditLimit}, existing exposure ${exposure}, this order ${orderTotal})`,
      );
    }
  }

  /**
   * Reserves stock for every line via Procurement's public API, then flips
   * the order to 'confirmed'. If any line can't be covered, every line
   * reserved earlier in this same call is released before the error
   * propagates — no partially-reserved order is left behind.
   */
  private async reserveAndConfirm(
    tenantId: string,
    actorUserId: string,
    order: OrderRecord,
  ): Promise<OrderRecord> {
    const lines = order.lines ?? [];
    const reservedLineIds: string[] = [];
    try {
      for (const line of lines) {
        await this.procurement.reserveLotsForOrderLine(tenantId, actorUserId, {
          orderLineId: line.id,
          productId: line.productId,
          quantity: Number(line.quantity),
        });
        reservedLineIds.push(line.id);
      }
    } catch (err) {
      for (const lineId of reservedLineIds) {
        await this.procurement.releaseLotsForOrderLine(tenantId, actorUserId, lineId);
      }
      throw err;
    }

    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.orders.findByIdWithClient(client, order.id);
      if (!before) throw new NotFoundException('Order not found');

      const after = await this.orders.confirmWithClient(client, order.id, before.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ORDER_ENTITY,
        entityId: order.id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}
