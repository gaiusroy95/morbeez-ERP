import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { OptimisticLockException } from '../../common/persistence/optimistic-lock.exception';
import { ApprovalsService } from '../approvals/approvals.service';
import { FarmersService } from '../farmers/farmers.service';
import { ProductsService } from '../products/products.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WorkforceService } from '../workforce/workforce.service';
import { PayablesService } from '../finance/payables.service';
import { FarmerPaymentRecord, LotPaymentStatus } from '../finance/entities/finance-engine.entity';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { PickupsRepository } from './repositories/pickups.repository';
import { ProcurementBoardRepository } from './repositories/procurement-board.repository';
import { AgentRecord, ProcurementBoard, ProcurementBoardDay } from './entities/procurement-board.entity';
import { CreateAgentDto } from './dto/procurement-board.dto';
import { LotsRepository } from './repositories/lots.repository';
import { PurchaseOrderRecord, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PickupRecord } from './entities/pickup.entity';
import { LotRecord, ProductStockRow } from './entities/lot.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { VersionDto } from './dto/version.dto';
import { SchedulePickupDto } from './dto/schedule-pickup.dto';
import { CompletePickupDto } from './dto/complete-pickup.dto';
import { ReceiveGoodsDto } from './dto/receive-goods.dto';
import { GradeLotDto } from './dto/grade-lot.dto';
import { SettleFarmerDto } from './dto/settle-farmer.dto';
import { AlertsRepository } from '../alerts/alerts.repository';
import { freeOf, LotStockRepository } from './repositories/lot-stock.repository';
import { fromMilli, minMilli, toMilli } from '../../common/quantity';

const PO_ENTITY = 'purchase_order';
const PICKUP_ENTITY = 'pickup';
const LOT_ENTITY = 'lot';

// The pre-seeded approval rule (database/seeds/003_dev_approval_roles_and_limits.ts)
// gates this exact action type — confirming a purchase order is the one
// procurement moment with real financial exposure large enough to need
// sign-off (Domain Model, Approvals integration).
const APPROVAL_ACTION_TYPE = 'purchase_order';

@Injectable()
export class ProcurementService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly purchaseOrders: PurchaseOrdersRepository,
    private readonly board: ProcurementBoardRepository,
    private readonly pickups: PickupsRepository,
    private readonly lots: LotsRepository,
    private readonly farmers: FarmersService,
    private readonly products: ProductsService,
    private readonly vehicles: VehiclesService,
    private readonly workforce: WorkforceService,
    private readonly approvals: ApprovalsService,
    private readonly payables: PayablesService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsRepository,
    private readonly stock: LotStockRepository,
  ) {}

  /** A purchase order closes once every lot on it has been paid for, however the payment was made. */
  onModuleInit(): void {
    this.payables.onLotsPaid((tenantId, actorUserId, lotIds) =>
      this.closePaidPurchaseOrders(tenantId, actorUserId, lotIds),
    );
  }

  // ---- The owner's Procurement list and agents (redesign V1.1) ----

  getBoard(tenantId: string, day: ProcurementBoardDay, q: string | null, page: number, pageSize: number): Promise<ProcurementBoard> {
    return this.db.withTenant(tenantId, (client) => this.board.board(client, day, q, page, pageSize));
  }

  listAgents(tenantId: string): Promise<AgentRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT id, name, phone, default_commission_per_kg::text AS commission, status FROM trading_partners.agent ORDER BY status, name`,
      );
      return r.rows.map((a) => ({ id: a.id, name: a.name, phone: a.phone, defaultCommissionPerKg: a.commission, status: a.status }));
    });
  }

  createAgent(tenantId: string, actorUserId: string, dto: CreateAgentDto): Promise<AgentRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `INSERT INTO trading_partners.agent (tenant_id, name, phone, default_commission_per_kg)
         VALUES ($1, $2, $3, $4) RETURNING id, name, phone, default_commission_per_kg::text AS commission, status`,
        [tenantId, dto.name.trim(), dto.phone?.trim() || null, dto.defaultCommissionPerKg ?? 0],
      );
      const a = r.rows[0];
      const agent: AgentRecord = { id: a.id, name: a.name, phone: a.phone, defaultCommissionPerKg: a.commission, status: a.status };
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'agent',
        entityId: agent.id,
        after: agent as unknown as Record<string, unknown>,
      });
      return agent;
    });
  }

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

  /**
   * A purchase order, with its pickup plan (date, time, driver, vehicle),
   * an optional agent and commission, and lines by the kilo or by the bag.
   * With `confirm`, it's confirmed in the same step — the owner's "Save
   * Procurement" (redesign V1.1) — and its pickup scheduled; an order over
   * the approval limit waits for approval instead, and its pickup is
   * scheduled once approved.
   */
  async createPurchaseOrder(
    tenantId: string,
    actorUserId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderRecord> {
    const farmer = await this.farmers.getById(tenantId, dto.farmerId);
    if (farmer.status !== 'active') throw new ConflictException('This farmer is archived');
    for (const line of dto.lines) {
      await this.products.getById(tenantId, line.productId);
      if ((line.bags === undefined) !== (line.kgPerBag === undefined)) {
        throw new BadRequestException('A line bought by the bag needs both the bags and the kg in each bag');
      }
      if (line.bags !== undefined && Math.abs(line.bags * line.kgPerBag! - line.expectedQuantity) > 0.0005) {
        throw new BadRequestException('A line bought by the bag must weigh bags × kg per bag');
      }
    }
    if (dto.vehicleId) await this.assertVehicleActive(tenantId, dto.vehicleId);
    if (dto.driverEmployeeId) await this.assertEmployeeActive(tenantId, dto.driverEmployeeId);
    if (dto.commissionPerKg !== undefined && !dto.agentId) throw new BadRequestException('A commission needs an agent');
    if (dto.pickupTime && !dto.pickupDate) throw new BadRequestException('A pickup time needs a pickup date');

    const po = await this.db.withTenant(tenantId, async (client) => {
      if (dto.agentId) {
        const agent = await client.query<{ status: string }>('SELECT status FROM trading_partners.agent WHERE id = $1', [dto.agentId]);
        if (!agent.rows[0]) throw new NotFoundException('Agent not found');
        if (agent.rows[0].status !== 'active') throw new ConflictException('This agent is archived');
      }
      const created = await this.purchaseOrders.createWithClient(client, tenantId, actorUserId, {
        farmerId: dto.farmerId,
        lines: dto.lines,
        pickupDate: dto.pickupDate ?? null,
        pickupTime: dto.pickupTime ?? null,
        plannedDriverId: dto.driverEmployeeId ?? null,
        plannedVehicleId: dto.vehicleId ?? null,
        agentId: dto.agentId ?? null,
        commissionPerKg: dto.commissionPerKg ?? null,
        notes: dto.notes?.trim() || null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: PO_ENTITY,
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return created;
    });
    if (!dto.confirm) return po;
    const confirmed = await this.confirmPurchaseOrder(tenantId, actorUserId, po.id, { version: po.version });
    if (confirmed.status === 'confirmed') await this.schedulePlannedPickup(tenantId, actorUserId, confirmed);
    return this.getPurchaseOrder(tenantId, po.id);
  }

  /** Turns a confirmed order's pickup plan into a scheduled pickup, once (nothing to do without a plan). */
  private async schedulePlannedPickup(tenantId: string, actorUserId: string, po: PurchaseOrderRecord): Promise<void> {
    if (!po.pickupDate && !po.plannedDriverId && !po.plannedVehicleId) return;
    await this.db.withTenant(tenantId, async (client) => {
      const existing = await client.query('SELECT 1 FROM commerce.pickup WHERE purchase_order_id = $1 LIMIT 1', [po.id]);
      if (existing.rowCount) return;
      const at = po.pickupDate
        ? (
            await client.query<{ at: Date }>(
              `SELECT (($1::date + COALESCE($2::time, '00:00'::time)) AT TIME ZONE t.timezone) AS at
                 FROM tenant.tenant t WHERE t.id = current_tenant_id()`,
              [po.pickupDate, po.pickupTime],
            )
          ).rows[0].at.toISOString()
        : null;
      const pickup = await this.pickups.createWithClient(client, tenantId, actorUserId, {
        purchaseOrderId: po.id,
        farmerId: po.farmerId,
        vehicleId: po.plannedVehicleId,
        driverEmployeeId: po.plannedDriverId,
        scheduledAt: at,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: PICKUP_ENTITY,
        entityId: pickup.id,
        after: pickup as unknown as Record<string, unknown>,
      });
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
        : await this.purchaseOrders.confirmWithClient(client, id, before.version, dto.expectedDeliveryDate ?? before.pickupDate ?? null);

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

    const finalized = await this.db.withTenant(tenantId, async (client) => {
      const after =
        request.status === 'approved'
          ? await this.purchaseOrders.confirmWithClient(client, id, before.version, before.pickupDate)
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
    if (finalized.status === 'confirmed') await this.schedulePlannedPickup(tenantId, actorUserId, finalized);
    return finalized;
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

  /**
   * A farm stop on a trip (driver app D0; the client's answer 1: the owner
   * sets the price). Each product is weighed and accepted or rejected at
   * the farm: the lot is graded there and then at the purchase order's
   * rate, its accepted kilos go onto the trip's vehicle, and the farmer is
   * owed for them at once. What was rejected stays at the farm.
   */
  async acceptAtFarm(
    tenantId: string,
    actorUserId: string,
    purchaseOrderId: string,
    input: {
      pickupId: string;
      tripId: string;
      vehicleId: string;
      lines: { productId: string; acceptedQuantity: number; rejectedQuantity: number; rejectionReason: string | null }[];
    },
  ): Promise<LotRecord[]> {
    const po = await this.getPurchaseOrder(tenantId, purchaseOrderId);
    if (po.status !== 'confirmed') {
      throw new ConflictException('Goods can only be received against a confirmed purchase order');
    }
    const rates = new Map((po.lines ?? []).map((line) => [line.productId, line.indicativePrice]));
    for (const line of input.lines) {
      if (!rates.has(line.productId)) {
        throw new BadRequestException(`Product ${line.productId} is not one of this purchase order's lines`);
      }
    }
    const weighed = input.lines.filter((line) => line.acceptedQuantity + line.rejectedQuantity > 0);
    if (weighed.length === 0) return [];

    return this.db.withTenant(tenantId, async (client) => {
      const vehicleLocationId = await this.stock.vehicleLocationWithClient(client, tenantId, actorUserId, input.vehicleId);
      const lots: LotRecord[] = [];
      for (const line of weighed) {
        const received = await this.lots.createWithClient(client, tenantId, actorUserId, {
          purchaseOrderId,
          farmerId: po.farmerId,
          productId: line.productId,
          pickupId: input.pickupId,
          receivedQuantity: Math.round((line.acceptedQuantity + line.rejectedQuantity) * 1000) / 1000,
        });
        const accepted = line.acceptedQuantity > 0;
        const lot = await this.lots.gradeWithClient(client, received.id, received.version, actorUserId, {
          acceptedQuantity: line.acceptedQuantity,
          rejectedQuantity: line.rejectedQuantity,
          grade: null,
          rejectionReason: line.rejectionReason,
          unitCost: accepted ? Number(rates.get(line.productId)) : null,
        });
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'create',
          entityType: LOT_ENTITY,
          entityId: lot.id,
          after: { ...lot, acceptedAtFarm: true, tripId: input.tripId } as unknown as Record<string, unknown>,
        });
        if (accepted && lot.currentQuantity) {
          await this.stock.createWithClient(client, tenantId, {
            lotId: lot.id,
            productId: lot.productId,
            locationId: vehicleLocationId,
            quantity: lot.currentQuantity,
          });
          await this.stock.insertMovementWithClient(client, tenantId, actorUserId, {
            lotId: lot.id,
            productId: lot.productId,
            type: 'picked_up',
            quantity: lot.currentQuantity,
            toLocationId: vehicleLocationId,
            tripId: input.tripId,
          });
        }
        if (accepted && lot.acceptedQuantity && lot.unitCost && lot.gradedAt) {
          await this.payables.accrueLotPayableWithClient(client, tenantId, actorUserId, {
            lotId: lot.id,
            farmerId: lot.farmerId,
            acceptedQuantity: lot.acceptedQuantity,
            unitCost: lot.unitCost,
            gradedAt: lot.gradedAt,
          });
        }
        await this.breakageAlertWithClient(client, tenantId, lot.id);
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
      await this.maybeMarkPurchaseOrderGraded(client, tenantId, actorUserId, purchaseOrderId);
      await this.closeIfPaidWithClient(client, tenantId, actorUserId, purchaseOrderId);

      const out: LotRecord[] = [];
      for (const lot of lots) out.push((await this.lots.findByIdWithClient(client, lot.id)) as LotRecord);
      return out;
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

      // What was accepted is stock now, in the store.
      if (!fullyRejected && after.currentQuantity) {
        await this.stock.createWithClient(client, tenantId, { lotId: after.id, productId: after.productId, locationId: null, quantity: after.currentQuantity });
      }

      // The cost is fixed now (LOT.2), so it's owed: posted in this same
      // transaction, so a graded lot and its payable exist together or not at all.
      if (!fullyRejected && after.acceptedQuantity && after.unitCost && after.gradedAt) {
        await this.payables.accrueLotPayableWithClient(client, tenantId, actorUserId, {
          lotId: after.id,
          farmerId: after.farmerId,
          acceptedQuantity: after.acceptedQuantity,
          unitCost: after.unitCost,
          gradedAt: after.gradedAt,
        });
      }

      await this.breakageAlertWithClient(client, tenantId, after.id);
      await this.maybeMarkPurchaseOrderGraded(client, tenantId, actorUserId, after.purchaseOrderId);
      // An advance may already have paid for everything on it.
      await this.closeIfPaidWithClient(client, tenantId, actorUserId, after.purchaseOrderId);

      return after;
    });
  }

  /**
   * Eggs that arrive broken are rejected at grading; more of them than the
   * owner accepts is a quality exception for them (client Q&A, eggs).
   */
  private async breakageAlertWithClient(client: PoolClient, tenantId: string, lotId: string): Promise<void> {
    const row = await this.lots.breakageWithClient(client, lotId);
    if (!row || Number(row.pct) <= Number(row.tolerance)) return;
    await this.alerts.raiseWithClient(client, tenantId, {
      kind: 'breakage',
      severity: 'critical',
      title: `Breakage ${row.pct}% on ${row.product} from ${row.farmer} — above ${row.tolerance}%`,
      detail: `${Number(row.rejected)} of ${Number(row.received)} eggs arrived broken.`,
      dedupeKey: `lot-breakage:${lotId}`,
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
  // Paying farmers belongs to Finance (Domain Model: Finance owns payables
  // and payments). These keep Procurement's lot-level view of it.

  /** What each lot on the purchase order was owed, and how much of it is paid. */
  async listSettlements(tenantId: string, purchaseOrderId: string): Promise<LotPaymentStatus[]> {
    const lots = await this.lots.listByPurchaseOrder(tenantId, purchaseOrderId);
    return this.payables.lotPaymentStatus(
      tenantId,
      lots.map((l) => l.id),
    );
  }

  /**
   * Pays one lot through Finance: its outstanding balance first, anything
   * beyond that as an advance on the farmer's next lots.
   */
  async settleFarmer(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    dto: SettleFarmerDto,
  ): Promise<FarmerPaymentRecord> {
    const lot = await this.getLot(tenantId, lotId);
    const [status] = await this.payables.lotPaymentStatus(tenantId, [lotId]);
    if (!status) throw new ConflictException('Nothing is owed on this lot: it is ungraded, rejected, or has no cost');
    if (Number(status.outstanding) <= 0) throw new ConflictException('This lot is already paid in full');

    const toLot = Math.min(dto.amount, Number(status.outstanding));
    return this.payables.recordPayment(tenantId, actorUserId, {
      farmerId: lot.farmerId,
      amount: dto.amount,
      method: dto.method,
      notes: dto.notes,
      allocations: [{ lotId, amount: toLot }],
    });
  }

  private async closePaidPurchaseOrders(tenantId: string, actorUserId: string, lotIds: string[]): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      const purchaseOrderIds = new Set<string>();
      for (const lotId of lotIds) {
        const lot = await this.lots.findByIdWithClient(client, lotId);
        if (lot) purchaseOrderIds.add(lot.purchaseOrderId);
      }
      for (const purchaseOrderId of purchaseOrderIds) {
        await this.closeIfPaidWithClient(client, tenantId, actorUserId, purchaseOrderId);
      }
    });
  }

  /** graded -> closed once nothing is owed on any of its lots. */
  private async closeIfPaidWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    purchaseOrderId: string,
  ): Promise<void> {
    const po = await this.purchaseOrders.findByIdWithClient(client, purchaseOrderId);
    if (!po || po.status !== 'graded') return;

    const lots = await this.lots.listByPurchaseOrderWithClient(client, purchaseOrderId);
    const statuses = await this.payables.lotPaymentStatusWithClient(
      client,
      lots.map((l) => l.id),
    );
    if (statuses.some((st) => Number(st.outstanding) > 0)) return;

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

  /**
   * Writes off kilos of a lot that are free in the store (stock lost or
   * found bad there). Kilos held for orders, or out on a vehicle, aren't
   * touched: a reservation is let go by its order, and a vehicle's stock
   * is counted when its trip is closed.
   */
  private async drawDown(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    expectedVersion: number,
    quantity: number,
    terminalStatus: 'available' | 'rejected',
  ): Promise<LotRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const found = await this.lots.findByIdWithClient(client, lotId);
      if (!found) throw new NotFoundException('Lot not found');
      const before = await this.lots.lockWithClient(client, lotId, expectedVersion);
      if (before.status !== 'available') {
        throw new ConflictException(`Cannot adjust a lot in status '${before.status}'`);
      }
      const places = await this.stock.inStoreForLotWithClient(client, lotId);
      const free = places.reduce((n, b) => n + freeOf(b), 0n);
      let left = toMilli(quantity.toFixed(3));
      if (left <= 0n || left > free) {
        throw new BadRequestException(
          `quantity must be positive and at most what's free of this lot in the store (${fromMilli(free)})`,
        );
      }
      for (const b of places) {
        const take = minMilli(freeOf(b), left);
        if (take <= 0n) continue;
        const done = await this.stock.takeWithClient(client, tenantId, b, { quantity: fromMilli(take), fromReserved: '0', orderLineId: null, sold: false });
        if (!done) throw new OptimisticLockException('Lot', lotId);
        left -= take;
        if (left <= 0n) break;
      }
      if (terminalStatus === 'rejected') await this.lots.markEmptyAsWithClient(client, lotId, 'rejected');

      const after = (await this.lots.findByIdWithClient(client, lotId)) as LotRecord;
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

  /**
   * Moves a lot's kilos in the store to a new location (a warehouse, or a
   * vehicle to sell from) — Inventory validates the location itself before
   * calling this. Kilos already out on a vehicle stay where they are.
   * Returns where each part came from, for Inventory's movement record.
   */
  async transferLot(
    tenantId: string,
    actorUserId: string,
    lotId: string,
    expectedVersion: number,
    toLocationId: string,
  ): Promise<{ lot: LotRecord; moves: { fromLocationId: string | null; quantity: string }[] }> {
    return this.db.withTenant(tenantId, async (client) => {
      const found = await this.lots.findByIdWithClient(client, lotId);
      if (!found) throw new NotFoundException('Lot not found');
      const before = await this.lots.lockWithClient(client, lotId, expectedVersion);
      if (before.status !== 'available') {
        throw new ConflictException(`Cannot transfer a lot in status '${before.status}'`);
      }
      const moves: { fromLocationId: string | null; quantity: string }[] = [];
      for (const b of await this.stock.inStoreForLotWithClient(client, lotId)) {
        if (b.locationId === toLocationId) continue;
        await this.stock.moveWithClient(client, tenantId, b, b.quantity, toLocationId, null);
        moves.push({ fromLocationId: b.locationId, quantity: b.quantity });
      }
      if (moves.length === 0) throw new BadRequestException('Nothing of this lot is in the store to move there');

      const after = await this.lots.touchWithClient(client, lotId);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: LOT_ENTITY,
        entityId: lotId,
        before: before as unknown as Record<string, unknown>,
        after: { ...after, moves } as unknown as Record<string, unknown>,
      });
      return { lot: after, moves };
    });
  }
}
