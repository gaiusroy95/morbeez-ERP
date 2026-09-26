import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { OptimisticLockException } from '../../common/persistence/optimistic-lock.exception';
import { ApprovalsService } from '../approvals/approvals.service';
import { FarmersService } from '../farmers/farmers.service';
import { ProductsService } from '../products/products.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WorkforceService } from '../workforce/workforce.service';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { PickupsRepository } from './repositories/pickups.repository';
import { LotsRepository } from './repositories/lots.repository';
import { FarmerSettlementsRepository } from './repositories/farmer-settlements.repository';
import { PurchaseOrderRecord, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PickupRecord } from './entities/pickup.entity';
import { LotRecord, ProductStockRow } from './entities/lot.entity';
import { FarmerSettlementRecord } from './entities/farmer-settlement.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { VersionDto } from './dto/version.dto';
import { SchedulePickupDto } from './dto/schedule-pickup.dto';
import { CompletePickupDto } from './dto/complete-pickup.dto';
import { ReceiveGoodsDto } from './dto/receive-goods.dto';
import { GradeLotDto } from './dto/grade-lot.dto';
import { SettleFarmerDto } from './dto/settle-farmer.dto';

const PO_ENTITY = 'purchase_order';
const PICKUP_ENTITY = 'pickup';
const LOT_ENTITY = 'lot';
const SETTLEMENT_ENTITY = 'farmer_settlement';

// The pre-seeded approval rule (database/seeds/003_dev_approval_roles_and_limits.ts)
// gates this exact action type — confirming a purchase order is the one
// procurement moment with real financial exposure large enough to need
// sign-off (Domain Model, Approvals integration).
const APPROVAL_ACTION_TYPE = 'purchase_order';

@Injectable()
export class ProcurementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly purchaseOrders: PurchaseOrdersRepository,
    private readonly pickups: PickupsRepository,
    private readonly lots: LotsRepository,
    private readonly settlements: FarmerSettlementsRepository,
    private readonly farmers: FarmersService,
    private readonly products: ProductsService,
    private readonly vehicles: VehiclesService,
    private readonly workforce: WorkforceService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  // ---- Purchase orders ----

  listPurchaseOrders(
    tenantId: string,
    status: PurchaseOrderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<PurchaseOrderRecord>> {
    return this.purchaseOrders.list(tenantId, status, page, pageSize);
  }

  async getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrderRecord> {
    const po = await this.purchaseOrders.findById(tenantId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async createPurchaseOrder(
    tenantId: string,
    actorUserId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderRecord> {
    await this.farmers.getById(tenantId, dto.farmerId);
    for (const line of dto.lines) {
      await this.products.getById(tenantId, line.productId);
    }

    return this.db.withTenant(tenantId, async (client) => {
      const po = await this.purchaseOrders.createWithClient(client, tenantId, actorUserId, {
        farmerId: dto.farmerId,
        lines: dto.lines,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: PO_ENTITY,
        entityId: po.id,
        after: po as unknown as Record<string, unknown>,
      });
      return po;
    });
  }

  /**
   * Two-phase confirmation: if the order's estimated value (sum of
   * expected_quantity * indicative_price) clears the seeded 'purchase_order'
   * approval threshold, the order stays 'placed' with approval_request_id
   * set, and finalizeConfirmation() must be called once that request is
   * decided — there is no event bus to do this automatically.
   */
  async confirmPurchaseOrder(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: ConfirmPurchaseOrderDto,
  ): Promise<PurchaseOrderRecord> {
    const before = await this.getPurchaseOrder(tenantId, id);
    if (before.status !== 'placed') {
      throw new ConflictException(`Cannot confirm a purchase order in status '${before.status}'`);
    }
    if (before.approvalRequestId) {
      throw new ConflictException(
        'Already awaiting an approval decision — call finalize-confirmation once it is decided',
      );
    }
    if (dto.version !== before.version) {
      throw new OptimisticLockException('PurchaseOrder', id);
    }

    const estimatedValue = await this.db.withTenant(tenantId, (client) =>
      this.purchaseOrders.computeEstimatedValueWithClient(client, id),
    );

    const evaluation = await this.approvals.evaluate(tenantId, actorUserId, {
      actionType: APPROVAL_ACTION_TYPE,
      subjectId: id,
      amount: estimatedValue,
    });

    return this.db.withTenant(tenantId, async (client) => {
      const after = evaluation.required
        ? await this.purchaseOrders.setApprovalRequestWithClient(client, id, before.version, evaluation.request.id)
        : await this.purchaseOrders.confirmWithClient(client, id, before.version, dto.expectedDeliveryDate ?? null);

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PO_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  async finalizeConfirmation(tenantId: string, actorUserId: string, id: string): Promise<PurchaseOrderRecord> {
    const before = await this.getPurchaseOrder(tenantId, id);
    if (!before.approvalRequestId) {
      throw new BadRequestException('This purchase order is not awaiting an approval decision');
    }
    if (before.status !== 'placed') {
      throw new ConflictException(`Cannot finalize confirmation from status '${before.status}'`);
    }

    const request = await this.approvals.getRequest(tenantId, before.approvalRequestId);
    if (request.status === 'pending') {
      throw new ConflictException('The approval decision is still pending');
    }

    return this.db.withTenant(tenantId, async (client) => {
      const after =
        request.status === 'approved'
          ? await this.purchaseOrders.confirmWithClient(client, id, before.version, null)
          : await this.purchaseOrders.cancelWithClient(client, id, before.version);

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PO_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  cancelPurchaseOrder(tenantId: string, actorUserId: string, id: string, dto: VersionDto): Promise<PurchaseOrderRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.purchaseOrders.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Purchase order not found');

      const after = await this.purchaseOrders.cancelWithClient(client, id, dto.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PO_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Pickups ----

  listPickups(tenantId: string, purchaseOrderId: string): Promise<PickupRecord[]> {
    return this.pickups.listByPurchaseOrder(tenantId, purchaseOrderId);
  }

  async schedulePickup(
    tenantId: string,
    actorUserId: string,
    purchaseOrderId: string,
    dto: SchedulePickupDto,
  ): Promise<PickupRecord> {
    const po = await this.getPurchaseOrder(tenantId, purchaseOrderId);
    if (po.status !== 'confirmed') {
      throw new ConflictException('A pickup can only be scheduled against a confirmed purchase order');
    }
    if (dto.vehicleId) await this.assertVehicleActive(tenantId, dto.vehicleId);
    if (dto.driverEmployeeId) await this.assertEmployeeActive(tenantId, dto.driverEmployeeId);

    return this.db.withTenant(tenantId, async (client) => {
      const pickup = await this.pickups.createWithClient(client, tenantId, actorUserId, {
        purchaseOrderId,
        farmerId: po.farmerId,
        vehicleId: dto.vehicleId ?? null,
        driverEmployeeId: dto.driverEmployeeId ?? null,
        scheduledAt: dto.scheduledAt ?? null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: PICKUP_ENTITY,
        entityId: pickup.id,
        after: pickup as unknown as Record<string, unknown>,
      });
      return pickup;
    });
  }

  async completePickup(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: CompletePickupDto,
  ): Promise<PickupRecord> {
    await this.assertVehicleActive(tenantId, dto.vehicleId);
    await this.assertEmployeeActive(tenantId, dto.driverEmployeeId);

    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.pickups.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Pickup not found');

      const after = await this.pickups.completeWithClient(client, id, dto.version, {
        vehicleId: dto.vehicleId,
        driverEmployeeId: dto.driverEmployeeId,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PICKUP_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /** Called by Logistics to validate a pickup before attaching it to a Trip stop, and to read its current version before completing it. */
  async getPickup(tenantId: string, id: string): Promise<PickupRecord> {
    const pickup = await this.pickups.findById(tenantId, id);
    if (!pickup) throw new NotFoundException('Pickup not found');
    return pickup;
  }

  cancelPickup(tenantId: string, actorUserId: string, id: string, dto: VersionDto): Promise<PickupRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.pickups.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Pickup not found');

      const after = await this.pickups.cancelWithClient(client, id, dto.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PICKUP_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  private async assertVehicleActive(tenantId: string, vehicleId: string): Promise<void> {
    const vehicle = await this.vehicles.getById(tenantId, vehicleId);
    if (vehicle.status !== 'active') {
      throw new ConflictException(`Vehicle is not active (status: ${vehicle.status})`);
    }
  }

  private async assertEmployeeActive(tenantId: string, employeeId: string): Promise<void> {
    const employee = await this.workforce.getById(tenantId, employeeId);
    if (employee.status !== 'active') {
      throw new ConflictException('Employee is not active');
    }
  }

  // ---- Goods receipt / Lots ----

  listLots(tenantId: string, purchaseOrderId: string): Promise<LotRecord[]> {
    return this.lots.listByPurchaseOrder(tenantId, purchaseOrderId);
  }

  async receiveGoods(
    tenantId: string,
    actorUserId: string,
    purchaseOrderId: string,
    dto: ReceiveGoodsDto,
  ): Promise<LotRecord[]> {
    const po = await this.getPurchaseOrder(tenantId, purchaseOrderId);
    if (po.status !== 'confirmed') {
      throw new ConflictException('Goods can only be received against a confirmed purchase order');
    }

    if (dto.pickupId) {
      const pickup = await this.pickups.findById(tenantId, dto.pickupId);
      if (!pickup) throw new NotFoundException('Pickup not found');
      if (pickup.purchaseOrderId !== purchaseOrderId) {
        throw new BadRequestException('Pickup does not belong to this purchase order');
      }
    }

    const knownProductIds = new Set((po.lines ?? []).map((line) => line.productId));
    for (const line of dto.lines) {
      if (!knownProductIds.has(line.productId)) {
        throw new BadRequestException(`Product ${line.productId} is not one of this purchase order's lines`);
      }
    }

    return this.db.withTenant(tenantId, async (client) => {
      const lots: LotRecord[] = [];
      for (const line of dto.lines) {
        const lot = await this.lots.createWithClient(client, tenantId, actorUserId, {
          purchaseOrderId,
          farmerId: po.farmerId,
          productId: line.productId,
          pickupId: dto.pickupId ?? null,
          receivedQuantity: line.receivedQuantity,
        });
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'create',
          entityType: LOT_ENTITY,
          entityId: lot.id,
          after: lot as unknown as Record<string, unknown>,
        });
        lots.push(lot);
      }

      const poBefore = await this.purchaseOrders.findByIdWithClient(client, purchaseOrderId);
      if (!poBefore) throw new NotFoundException('Purchase order not found');
      const poAfter = await this.purchaseOrders.markReceivedWithClient(client, purchaseOrderId, poBefore.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PO_ENTITY,
        entityId: purchaseOrderId,
        before: poBefore as unknown as Record<string, unknown>,
        after: poAfter as unknown as Record<string, unknown>,
      });

      return lots;
    });
  }

  async gradeLot(tenantId: string, actorUserId: string, id: string, dto: GradeLotDto): Promise<LotRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.lots.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Lot not found');

      const receivedQuantity = Number(before.receivedQuantity);
      if (Math.abs(dto.acceptedQuantity + dto.rejectedQuantity - receivedQuantity) > 1e-6) {
        throw new BadRequestException(
          `Accepted (${dto.acceptedQuantity}) + rejected (${dto.rejectedQuantity}) must equal received quantity (${receivedQuantity})`,
        );
      }
      const fullyRejected = dto.acceptedQuantity === 0;
      if (!fullyRejected && dto.unitCost === undefined) {
        throw new BadRequestException('unitCost is required unless the lot is fully rejected');
      }

      const after = await this.lots.gradeWithClient(client, id, dto.version, actorUserId, {
        acceptedQuantity: dto.acceptedQuantity,
        rejectedQuantity: dto.rejectedQuantity,
        grade: dto.grade ?? null,
        rejectionReason: dto.rejectionReason ?? null,
        unitCost: fullyRejected ? null : dto.unitCost ?? null,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: LOT_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });

      await this.maybeMarkPurchaseOrderGraded(client, tenantId, actorUserId, after.purchaseOrderId);

      return after;
    });
  }

  private async maybeMarkPurchaseOrderGraded(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    purchaseOrderId: string,
  ): Promise<void> {
    const remainingUngraded = await this.lots.countUngradedWithClient(client, purchaseOrderId);
    if (remainingUngraded > 0) return;

    const po = await this.purchaseOrders.findByIdWithClient(client, purchaseOrderId);
    if (!po || po.status !== 'received') return;

    const after = await this.purchaseOrders.markGradedWithClient(client, po.id, po.version);
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'update',
      entityType: PO_ENTITY,
      entityId: po.id,
      before: po as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
  }

  // ---- Farmer settlement ----

  listSettlements(tenantId: string, purchaseOrderId: string): Promise<FarmerSettlementRecord[]> {
    return this.settlements.listByPurchaseOrder(tenantId, purchaseOrderId);
  }

  async settleFarmer(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    dto: SettleFarmerDto,
  ): Promise<FarmerSettlementRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const lot = await this.lots.findByIdWithClient(client, lotId);
      if (!lot) throw new NotFoundException('Lot not found');
      if (lot.status !== 'available') {
        throw new ConflictException(`Only a graded, available lot can be settled (status: ${lot.status})`);
      }

      const settlement = await this.settlements.createWithClient(client, tenantId, actorUserId, {
        lotId,
        farmerId: lot.farmerId,
        amount: dto.amount,
        method: dto.method,
        notes: dto.notes ?? null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: SETTLEMENT_ENTITY,
        entityId: settlement.id,
        after: settlement as unknown as Record<string, unknown>,
      });

      await this.maybeClosePurchaseOrder(client, tenantId, actorUserId, lot.purchaseOrderId);

      return settlement;
    });
  }

  private async maybeClosePurchaseOrder(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    purchaseOrderId: string,
  ): Promise<void> {
    const po = await this.purchaseOrders.findByIdWithClient(client, purchaseOrderId);
    if (!po || po.status !== 'graded') return;

    const remainingUnsettled = await this.lots.countUnsettledAvailableWithClient(client, purchaseOrderId);
    if (remainingUnsettled > 0) return;

    const after = await this.purchaseOrders.closeWithClient(client, po.id, po.version);
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'update',
      entityType: PO_ENTITY,
      entityId: po.id,
      before: po as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
  }

  // ---- Stock reservation (called by Orders — Constitution I.3-I.4: the
  // public service API is how another bounded context claims stock, never
  // a direct import of LotsRepository) ----

  /**
   * Claims whole available lots for this product, oldest received_at
   * first, until `quantity` is covered — never a fraction of one lot
   * (see the migration comment on commerce.lot.reserved_for_order_line_id).
   * All-or-nothing: if the product's available lots can't cover the
   * requested quantity, every reservation attempted in this call rolls
   * back (the throw inside db.withTenant's work callback triggers
   * DatabaseService.transaction's ROLLBACK) rather than leaving a partial
   * claim for the caller to unwind.
   */
  async reserveLotsForOrderLine(
    tenantId: string,
    actorUserId: string,
    fields: { orderLineId: string; productId: string; quantity: number },
  ): Promise<LotRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const candidates = await this.lots.lockAvailableForProductWithClient(client, tenantId, fields.productId);

      const claimed: LotRecord[] = [];
      let remaining = fields.quantity;
      for (const lot of candidates) {
        if (remaining <= 0) break;

        const after = await this.lots.reserveWithClient(client, lot.id, lot.version, fields.orderLineId);
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'update',
          entityType: LOT_ENTITY,
          entityId: lot.id,
          before: lot as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        claimed.push(after);
        remaining -= Number(lot.currentQuantity ?? 0);
      }

      if (remaining > 0) {
        throw new ConflictException(
          `Insufficient available stock for product ${fields.productId}: short by ${remaining}`,
        );
      }
      return claimed;
    });
  }

  /** Reverses reserveLotsForOrderLine — every lot it claimed goes back to 'available'. */
  async releaseLotsForOrderLine(tenantId: string, actorUserId: string, orderLineId: string): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      const reserved = await this.lots.listReservedForOrderLineWithClient(client, orderLineId);
      for (const lot of reserved) {
        const after = await this.lots.releaseWithClient(client, lot.id, lot.version);
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'update',
          entityType: LOT_ENTITY,
          entityId: lot.id,
          before: lot as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
      }
    });
  }

  /**
   * Called by Orders once an order is delivered: its reserved lots have
   * left the warehouse. They move to 'delivered' and keep their link to the
   * order line, which is how cost of goods finds them.
   */
  async consumeLotsForOrderLine(tenantId: string, actorUserId: string, orderLineId: string): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      const lots = await this.lots.listReservedForOrderLineWithClient(client, orderLineId);
      for (const lot of lots.filter((l) => l.status === 'reserved')) {
        const after = await this.lots.consumeWithClient(client, lot.id, lot.version);
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'update',
          entityType: LOT_ENTITY,
          entityId: lot.id,
          before: lot as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
      }
    });
  }

  /** Stock for every product in one read — for Inventory's overview. */
  stockByProduct(tenantId: string): Promise<ProductStockRow[]> {
    return this.lots.stockByProduct(tenantId);
  }

  // ---- Lot custody for the Inventory Engine (called by Inventory —
  // Constitution I.3-I.4: Procurement is Lot's owner and the only module
  // that ever writes to commerce.lot directly; Inventory drives these,
  // then records its own movement-ledger entry against the result) ----

  /** Raw, per-product lot data for Inventory's physical/available/reserved stock summary. */
  listLotsForProduct(tenantId: string, productId: string): Promise<LotRecord[]> {
    return this.lots.listForProduct(tenantId, productId);
  }

  async getLot(tenantId: string, id: string): Promise<LotRecord> {
    const lot = await this.lots.findById(tenantId, id);
    if (!lot) throw new NotFoundException('Lot not found');
    return lot;
  }

  /**
   * Reduces an available lot's current_quantity by `quantity` — stock
   * physically lost (spoilage, evaporation, miscount) with no quality
   * finding attached to it. Draining it to exactly zero leaves the lot
   * 'available' with nothing left, rather than 'rejected' — shrinkage
   * isn't a quality verdict, so it doesn't earn that status.
   */
  async recordShrinkage(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    expectedVersion: number,
    quantity: number,
  ): Promise<LotRecord> {
    return this.drawDown(tenantId, actorUserId, lotId, expectedVersion, quantity, 'available');
  }

  /**
   * Reduces an available lot's current_quantity by `quantity` for a
   * quality problem found after it had already been accepted at grading —
   * distinct from Procurement's own grading-time rejection (gradeLot),
   * which happens before a lot is ever 'available'. Draining it to
   * exactly zero flips the lot to 'rejected', same terminal state
   * grading-time rejection produces.
   */
  async recordRejectionPostAcceptance(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    expectedVersion: number,
    quantity: number,
  ): Promise<LotRecord> {
    return this.drawDown(tenantId, actorUserId, lotId, expectedVersion, quantity, 'rejected');
  }

  private async drawDown(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    expectedVersion: number,
    quantity: number,
    terminalStatus: 'available' | 'rejected',
  ): Promise<LotRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.lots.findByIdWithClient(client, lotId);
      if (!before) throw new NotFoundException('Lot not found');
      if (before.status !== 'available') {
        throw new ConflictException(
          `Cannot adjust a lot in status '${before.status}' — release any reservation on it first`,
        );
      }
      if (quantity <= 0 || quantity > Number(before.currentQuantity ?? 0)) {
        throw new BadRequestException(
          `quantity must be positive and at most the lot's current quantity (${before.currentQuantity})`,
        );
      }

      const after = await this.lots.drawDownWithClient(client, lotId, expectedVersion, quantity, terminalStatus);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: LOT_ENTITY,
        entityId: lotId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /** Moves an available lot to a new location — Inventory validates the location itself before calling this. */
  async transferLot(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    expectedVersion: number,
    toLocationId: string,
  ): Promise<LotRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.lots.findByIdWithClient(client, lotId);
      if (!before) throw new NotFoundException('Lot not found');
      if (before.status !== 'available') {
        throw new ConflictException(`Cannot transfer a lot in status '${before.status}'`);
      }

      const after = await this.lots.transferWithClient(client, lotId, expectedVersion, toLocationId);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: LOT_ENTITY,
        entityId: lotId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}
