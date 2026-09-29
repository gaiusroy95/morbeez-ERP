import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { WorkforceService } from '../workforce/workforce.service';
import { LedgerService } from '../finance/ledger.service';
import { ReceivablesService } from '../finance/receivables.service';
import { assertRealDate } from '../../common/period';
import { clampPageSize, PaginatedResult } from '../../common/persistence/pagination';
import { moneyFromNumber, subtractMoney, sumMoney, toCents } from '../../common/money';
import { SaleHeaderRow, SpotSalesRepository } from './repositories/spot-sales.repository';
import { fromMilli, judgeLine, lineValue, planDraw, resolveBand, toMilli, unitCostOf, VehicleLot } from './spot-math';
import { PriceBand, SpotSaleRecord, SpotSalesSummary, SpotSettings, VehicleStockRow } from './entities/spot-sales.entity';
import { PriceBandDto, RecordSpotSaleDto, SpotSettingsDto } from './dto/spot-sales.dto';

export const APPROVAL_ACTION_TYPE = 'spot_sale_price';
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const OPEN_TRIP = ['in_progress'];

export interface SpotActor {
  tenantId: string;
  userId: string;
  permissions: string[];
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const qty3 = (n: number) => n.toFixed(3);

/**
 * Driver spot sales: a driver on the road sells from the stock on their
 * vehicle to a walk-in buyer, who pays on the spot. No governing spec
 * covers spot sales; this follows Driver App Architecture's rules for
 * every driver operation — one client-generated idempotent call (DRV.5/6),
 * only on the caller's own trip (DRV.15), no lot id from the device
 * (DRV.18: the server draws the vehicle's own lots, oldest first) — and
 * posts through Finance in the same transaction (DE.1):
 *   Dr Cost of goods sold / Cr Inventory            the lots drawn, at their own cost (LOT.1)
 *   Dr Accounts receivable / Cr Sales / Cr GST      a 'spot_sale' invoice to the walk-in customer
 *   Dr Cash with drivers (cash) or Bank (UPI) / Cr Accounts receivable   paid at once
 * A price outside its product's band, or below what the stock cost, files
 * an approval request instead; the stock is held until it's decided, and
 * the sale completes only once approved.
 */
@Injectable()
export class SpotSalesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SpotSalesRepository,
    private readonly approvals: ApprovalsService,
    private readonly workforce: WorkforceService,
    private readonly ledger: LedgerService,
    private readonly receivables: ReceivablesService,
    private readonly audit: AuditService,
  ) {}

  // ---- Settings and bands ----

  getSettings(tenantId: string): Promise<SpotSettings> {
    return this.db.withTenant(tenantId, (client) => this.repo.settings(client));
  }

  saveSettings(tenantId: string, userId: string, dto: SpotSettingsDto): Promise<SpotSettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.settings(client);
      const ok = await this.repo.saveSettings(client, tenantId, userId, dto.version, {
        floor: dto.defaultFloorPct.toFixed(2),
        ceiling: dto.defaultCeilingPct.toFixed(2),
      });
      if (!ok) throw new ConflictException('Spot sale settings were changed by someone else — reload and try again');
      const after = await this.repo.settings(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.version === 0 ? 'create' : 'update',
        entityType: 'spot_settings',
        entityId: tenantId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  listBands(tenantId: string, productId?: string): Promise<PriceBand[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.bands(client, productId ?? null));
  }

  /** A new band from a date; the one open then ends the day before. */
  addBand(tenantId: string, userId: string, dto: PriceBandDto): Promise<PriceBand[]> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    if (dto.maxPrice !== undefined && dto.maxPrice < dto.minPrice) throw new BadRequestException('The highest price is below the lowest');
    return this.db.withTenant(tenantId, async (client) => {
      const product = (await this.repo.products(client, [dto.productId])).get(dto.productId);
      if (!product) throw new NotFoundException('Product not found');
      if (!(await this.repo.endOpenBand(client, dto.productId, dto.effectiveFrom))) {
        throw new ConflictException(`${product.name} already has a band starting on or after ${dto.effectiveFrom}`);
      }
      const id = await this.repo.insertBand(client, {
        tenantId,
        productId: dto.productId,
        minPrice: moneyFromNumber(dto.minPrice),
        maxPrice: dto.maxPrice !== undefined ? moneyFromNumber(dto.maxPrice) : null,
        effectiveFrom: dto.effectiveFrom,
        notes: clean(dto.notes),
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'price_band', entityId: id, after: { ...dto } });
      return this.repo.bands(client, dto.productId);
    });
  }

  // ---- Whose trip ----

  /**
   * DRV.15: a driver acts only on their own trip; someone who dispatches
   * trips may act on any (recording a sale the driver phoned in).
   * Returns the trip's driver.
   */
  private async assertTrip(actor: SpotActor, trip: { driver_employee_id: string }): Promise<void> {
    if (actor.permissions.includes('logistics:dispatch')) return;
    const employeeId = await this.workforce.getEmployeeIdForUser(actor.tenantId, actor.userId);
    if (!employeeId || employeeId !== trip.driver_employee_id) throw new ForbiddenException('You may only sell from your own trip');
  }

  /** What the trip's vehicle can sell right now, and the band each price is judged by. */
  async vehicleStock(actor: SpotActor, tripId: string): Promise<VehicleStockRow[]> {
    const trip = await this.db.withTenant(actor.tenantId, (client) => this.repo.trip(client, tripId));
    if (!trip) throw new NotFoundException('Trip not found');
    await this.assertTrip(actor, trip);
    return this.db.withTenant(actor.tenantId, async (client) => {
      const books = await this.repo.books(client);
      const lots = await this.repo.vehicleLots(client, trip.vehicle_id);
      const held = await this.repo.held(client, trip.vehicle_id, null);
      const productIds = [...new Set(lots.map((l) => l.product_id))];
      const products = await this.repo.products(client, productIds);
      const bands = await this.repo.bandsInForce(client, productIds, books.today);
      const settings = await this.repo.settings(client);
      return productIds
        .map((id) => {
          const p = products.get(id)!;
          const on = lots.filter((l) => l.product_id === id).reduce((s, l) => s + toMilli(l.quantity), 0n);
          const h = toMilli(held.get(id) ?? '0');
          const band = resolveBand(bands.get(id) ?? null, p.basePrice, { floorPct: settings.defaultFloorPct, ceilingPct: settings.defaultCeilingPct });
          return {
            productId: id,
            productName: p.name,
            uom: p.uom,
            onVehicle: fromMilli(on),
            held: fromMilli(h),
            sellable: fromMilli(on > h ? on - h : 0n),
            basePrice: p.basePrice,
            band,
          };
        })
        .sort((a, b) => a.productName.localeCompare(b.productName));
    });
  }

  // ---- Recording ----

  /**
   * Records a sale from the device. A replay of the same clientRef returns
   * the sale already recorded (DRV.6) rather than selling twice. Prices
   * inside their bands complete at once; any outside file one approval
   * request for the sale, sized by how far off they are, and hold the stock.
   */
  async record(actor: SpotActor, dto: RecordSpotSaleDto): Promise<SpotSaleRecord> {
    const { tenantId, userId } = actor;
    const soldAt = dto.soldAt ? new Date(dto.soldAt) : new Date();
    if (soldAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) throw new BadRequestException('soldAt cannot be in the future');
    const productIds = dto.lines.map((l) => l.productId);
    if (new Set(productIds).size !== productIds.length) throw new BadRequestException('Each product once per sale');
    if (dto.paymentMethod === 'upi' && !clean(dto.paymentReference)) throw new BadRequestException('Enter the UPI transaction id');

    const replay = await this.db.withTenant(tenantId, (client) => this.repo.findByClientRef(client, dto.clientRef));
    if (replay) {
      if (replay.trip_id !== dto.tripId) throw new ConflictException('That clientRef was already used for another trip');
      return this.getSale(actor, replay.id);
    }
    const trip = await this.db.withTenant(tenantId, (client) => this.repo.trip(client, dto.tripId));
    if (!trip) throw new NotFoundException('Trip not found');
    await this.assertTrip(actor, trip);
    if (!OPEN_TRIP.includes(trip.status)) throw new ConflictException(`Spot sales are made on a trip on the road — this one is ${trip.status.replace('_', ' ')}`);

    const saleId = await this.db.withTenant(tenantId, async (client) => {
      await this.repo.lockVehicle(client, trip.vehicle_id);
      // Checked again under the lock: two replays racing each other.
      const again = await this.repo.findByClientRef(client, dto.clientRef);
      if (again) return again.id;

      const books = await this.repo.books(client);
      const products = await this.repo.products(client, productIds);
      const bands = await this.repo.bandsInForce(client, productIds, books.today);
      const settings = await this.repo.settings(client);
      const lots = await this.repo.vehicleLots(client, trip.vehicle_id);
      const held = await this.repo.held(client, trip.vehicle_id, null);

      const judged = dto.lines.map((line) => {
        const p = products.get(line.productId);
        if (!p) throw new NotFoundException('Product not found');
        if (p.status !== 'active') throw new ConflictException(`${p.name} is archived`);
        const quantity = qty3(line.quantity);
        const unitPrice = moneyFromNumber(line.unitPrice);
        // Sellable = on the vehicle less what pending sales hold; costed as the draw would be.
        const mine: VehicleLot[] = lots.filter((l) => l.product_id === line.productId).map((l) => ({ lotId: l.lot_id, quantity: l.quantity, unitCost: l.unit_cost, receivedAt: l.received_at }));
        const on = mine.reduce((s, l) => s + toMilli(l.quantity), 0n);
        const free = on - toMilli(held.get(line.productId) ?? '0');
        if (toMilli(quantity) > free) {
          throw new ConflictException(`${trip.registration_number} has only ${fromMilli(free > 0n ? free : 0n)} ${p.uom} of ${p.name} free to sell`);
        }
        const plan = planDraw(mine, quantity);
        const unitCost = plan ? unitCostOf(plan.cost, quantity) : null;
        const band = resolveBand(bands.get(line.productId) ?? null, p.basePrice, { floorPct: settings.defaultFloorPct, ceilingPct: settings.defaultCeilingPct });
        const verdict = judgeLine({ quantity, unitPrice }, band, unitCost);
        return { productId: line.productId, quantity, unitPrice, amount: lineValue(quantity, unitPrice), band, unitCost, verdict };
      });
      const subtotal = sumMoney(judged.map((j) => j.amount));
      const exceptionValue = sumMoney(judged.map((j) => j.verdict.value));
      const needsApproval = toCents(exceptionValue) > 0n;

      const id = randomUUID();
      const request = needsApproval
        ? await this.approvals.requireWithClient(client, tenantId, userId, { actionType: APPROVAL_ACTION_TYPE, subjectId: id, amount: Number(exceptionValue) })
        : null;
      const saleNumber = await this.repo.nextSaleNumber(client);
      await this.repo.insertSale(client, {
        id,
        tenantId,
        saleNumber,
        clientRef: dto.clientRef,
        tripId: trip.id,
        vehicleId: trip.vehicle_id,
        driverEmployeeId: trip.driver_employee_id,
        buyerName: clean(dto.buyerName),
        buyerPhone: clean(dto.buyerPhone),
        paymentMethod: dto.paymentMethod,
        paymentReference: clean(dto.paymentReference),
        status: 'pending_approval',
        subtotal,
        exceptionValue,
        approvalRequestId: request?.id ?? null,
        soldAt,
        userId,
      });
      for (const j of judged) {
        await this.repo.insertLine(client, {
          tenantId,
          saleId: id,
          productId: j.productId,
          quantity: j.quantity,
          unitPrice: j.unitPrice,
          amount: j.amount,
          bandSource: j.band.source,
          bandMin: j.band.min,
          bandMax: j.band.max,
          unitCostEstimate: j.unitCost,
          exception: j.verdict.exception,
          exceptionValue: j.verdict.value,
        });
      }
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'create',
        entityType: 'spot_sale',
        entityId: id,
        after: { saleNumber, tripId: trip.id, subtotal, exceptionValue, approvalRequestId: request?.id ?? null, lines: judged.map((j) => ({ productId: j.productId, quantity: j.quantity, unitPrice: j.unitPrice, exception: j.verdict.exception })) },
      });
      if (!needsApproval) await this.completeWithClient(client, tenantId, userId, (await this.repo.header(client, id))!);
      return id;
    });
    return this.getSale(actor, saleId);
  }

  /**
   * Completes a sale: draws the vehicle's lots, oldest first, costs them to
   * COGS, records the stock movement, invoices the walk-in customer and
   * takes the payment. Refused if the trip has been reconciled (its cash is
   * closed) or the vehicle no longer holds the stock.
   */
  private async completeWithClient(client: PoolClient, tenantId: string, userId: string, sale: SaleHeaderRow): Promise<void> {
    const trip = (await this.repo.trip(client, sale.trip_id))!;
    if (trip.status === 'reconciled' || trip.status === 'cancelled') {
      throw new ConflictException(`Trip is ${trip.status} — this sale can no longer be completed; reject it`);
    }
    const lines = (await this.repo.lines(client, [sale.id])).get(sale.id) ?? [];
    const lots = await this.repo.vehicleLots(client, sale.vehicle_id);
    const products = await this.repo.products(client, lines.map((l) => l.productId));
    const costs: string[] = [];
    for (const line of lines) {
      const mine = lots.filter((l) => l.product_id === line.productId);
      const plan = planDraw(mine.map((l) => ({ lotId: l.lot_id, quantity: l.quantity, unitCost: l.unit_cost, receivedAt: l.received_at })), line.quantity);
      if (!plan) throw new ConflictException(`${trip.registration_number} no longer holds ${line.quantity} of ${line.productName}`);
      for (const d of plan.draws) {
        if (!(await this.repo.drawLot(client, d.lotId, d.quantity))) throw new ConflictException(`A lot of ${line.productName} changed while selling — try again`);
        await this.repo.insertLineLot(client, tenantId, line.id, d.lotId, d.quantity, d.unitCost);
        await this.repo.insertStockMovement(client, {
          tenantId,
          lotId: d.lotId,
          productId: line.productId,
          quantity: d.quantity,
          locationId: mine.find((l) => l.lot_id === d.lotId)!.location_id,
          reason: `Spot sale ${sale.sale_number}`,
          userId,
        });
      }
      costs.push(plan.cost);
    }
    const cost = sumMoney(costs);
    await this.ledger.postSystemWithClient(client, {
      tenantId,
      entryType: 'cogs_recognized',
      sourceType: 'spot_sale',
      sourceId: sale.id,
      occurredAt: sale.sold_at,
      memo: `Cost of spot sale ${sale.sale_number} from ${trip.registration_number}`,
      createdBy: userId,
      lines: [
        { account: 'cost_of_goods_sold', debit: cost },
        { account: 'inventory_asset', credit: cost },
      ],
    });
    const invoice = await this.receivables.issueSpotSaleWithClient(client, tenantId, userId, {
      saleId: sale.id,
      saleNumber: sale.sale_number,
      buyer: sale.buyer_name,
      lines: lines.map((l) => ({ productId: l.productId, description: `${products.get(l.productId)?.name ?? l.productName} (spot sale)`, quantity: l.quantity, unitPrice: l.unitPrice })),
      method: sale.payment_method,
      reference: sale.payment_reference,
      occurredAt: sale.sold_at,
    });
    await this.repo.complete(client, sale.id, {
      taxTotal: subtractMoney(invoice.total, invoice.taxableValue),
      total: invoice.total,
      costTotal: cost,
      invoiceId: invoice.invoiceId,
      paymentId: invoice.paymentId,
    });
    await this.audit.record(client, {
      tenantId,
      actorUserId: userId,
      action: 'update',
      entityType: 'spot_sale',
      entityId: sale.id,
      before: { status: sale.status },
      after: { status: 'completed', invoiceNumber: invoice.invoiceNumber, total: invoice.total, cost },
    });
  }

  // ---- Approval ----

  /**
   * Decides the sale's price exception through the approval framework —
   * never the person who recorded it, and only within the decider's role
   * limit for 'spot_sale_price' — then settles the sale accordingly.
   */
  async decide(actor: SpotActor, id: string, approved: boolean, note?: string): Promise<SpotSaleRecord> {
    const sale = await this.db.withTenant(actor.tenantId, (client) => this.repo.header(client, id));
    if (!sale) throw new NotFoundException('Spot sale not found');
    if (sale.status !== 'pending_approval' || !sale.approval_request_id) throw new ConflictException(`This sale is ${sale.status.replace('_', ' ')}, not awaiting approval`);
    const request = await this.approvals.getRequest(actor.tenantId, sale.approval_request_id);
    await this.approvals.decide(actor.tenantId, actor.userId, request.id, request.version, approved, clean(note) ?? undefined);
    return this.sync(actor, id);
  }

  /**
   * Brings a pending sale in line with its approval request — for a decision
   * made on the Approvals page. Approved: completes; rejected or cancelled:
   * closes and releases the stock it held. Idempotent.
   */
  async sync(actor: SpotActor, id: string): Promise<SpotSaleRecord> {
    const sale = await this.db.withTenant(actor.tenantId, (client) => this.repo.header(client, id));
    if (!sale) throw new NotFoundException('Spot sale not found');
    if (sale.status === 'pending_approval' && sale.approval_request_id) {
      const request = await this.approvals.getRequest(actor.tenantId, sale.approval_request_id);
      if (request.status !== 'pending') {
        await this.db.withTenant(actor.tenantId, async (client) => {
          await this.repo.lockVehicle(client, sale.vehicle_id);
          const current = (await this.repo.header(client, id))!;
          if (current.status !== 'pending_approval') return;
          if (request.status === 'approved') {
            await this.completeWithClient(client, actor.tenantId, actor.userId, current);
          } else {
            const reason = request.status === 'rejected' ? `Price not approved${request.decisionNote ? `: ${request.decisionNote}` : ''}` : 'Withdrawn by the driver';
            await this.repo.close(client, id, request.status === 'rejected' ? 'rejected' : 'cancelled', reason);
            await this.audit.record(client, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'update', entityType: 'spot_sale', entityId: id, before: { status: 'pending_approval' }, after: { status: request.status, reason } });
          }
        });
      }
    }
    return this.getSale(actor, id);
  }

  /** The person who recorded a pending sale withdraws it (the buyer walked away). */
  async cancel(actor: SpotActor, id: string): Promise<SpotSaleRecord> {
    const sale = await this.db.withTenant(actor.tenantId, (client) => this.repo.header(client, id));
    if (!sale) throw new NotFoundException('Spot sale not found');
    if (sale.status !== 'pending_approval' || !sale.approval_request_id) throw new ConflictException(`This sale is ${sale.status.replace('_', ' ')} — only one awaiting approval can be withdrawn`);
    const request = await this.approvals.getRequest(actor.tenantId, sale.approval_request_id);
    if (request.status === 'pending') await this.approvals.cancel(actor.tenantId, actor.userId, request.id, request.version);
    return this.sync(actor, id);
  }

  // ---- Reads ----

  /**
   * Whose sales the caller may see: everyone's with spot_sales:read (the
   * office, approvers); a driver with only spot_sales:record, their own.
   */
  private async scope(actor: SpotActor): Promise<string | null> {
    if (actor.permissions.includes('spot_sales:read')) return null;
    if (!actor.permissions.includes('spot_sales:record')) throw new ForbiddenException('Missing permission(s): spot_sales:read');
    const employeeId = await this.workforce.getEmployeeIdForUser(actor.tenantId, actor.userId);
    if (!employeeId) throw new ForbiddenException('Your login is not linked to a driver');
    return employeeId;
  }

  async getSale(actor: SpotActor, id: string): Promise<SpotSaleRecord> {
    const driver = await this.scope(actor);
    const sale = await this.db.withTenant(actor.tenantId, (client) => this.repo.find(client, id));
    if (!sale || (driver && sale.driverEmployeeId !== driver)) throw new NotFoundException('Spot sale not found');
    return driver ? withoutCost(sale) : sale;
  }

  async list(
    actor: SpotActor,
    q: { from?: string; to?: string; status?: string; tripId?: string; page?: number; pageSize?: number },
  ): Promise<PaginatedResult<SpotSaleRecord>> {
    const driver = await this.scope(actor);
    const page = q.page ?? 1;
    const pageSize = clampPageSize(q.pageSize);
    return this.db.withTenant(actor.tenantId, async (client) => {
      const books = await this.repo.books(client);
      const { sales, total } = await this.repo.list(client, {
        timezone: books.timezone, from: q.from ?? null, to: q.to ?? null, status: q.status ?? null, tripId: q.tripId ?? null,
        driverEmployeeId: driver, limit: pageSize, offset: (page - 1) * pageSize,
      });
      return { items: driver ? sales.map(withoutCost) : sales, total, page, pageSize };
    });
  }

  async summary(actor: SpotActor, from: string, to: string): Promise<SpotSalesSummary> {
    assertRealDate(from, 'from');
    assertRealDate(to, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    return this.db.withTenant(actor.tenantId, async (client) => {
      const books = await this.repo.books(client);
      const t = await this.repo.totals(client, { timezone: books.timezone, from, to });
      return {
        from,
        to,
        currency: books.currency,
        completed: t.completed,
        pending: t.pending,
        revenue: t.revenue,
        tax: t.tax,
        cost: t.cost,
        margin: subtractMoney(t.revenue, t.cost),
        cash: t.cash,
        upi: t.upi,
        exceptionsApproved: t.exceptions,
      };
    });
  }
}

/**
 * A driver sees what they sold and for how much, never what the stock cost
 * the business or the margin on it (Constitution V.2, Security Audit SA-05).
 */
function withoutCost(sale: SpotSaleRecord): SpotSaleRecord {
  return {
    ...sale,
    costTotal: null,
    margin: null,
    // Which lots it came from carries each lot's cost, so that goes too.
    lines: sale.lines.map((l) => ({ ...l, unitCostEstimate: null, lots: [] })),
  };
}
