import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CustomersRepository } from './repositories/customers.repository';
import { CustomerRecord } from './entities/customer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateCreditTermsDto } from './dto/update-credit-terms.dto';
import { RoutesService } from '../routes/routes.service';
import { CustomerInsightsRepository, CustomerFiguresRow } from './repositories/customer-insights.repository';
import { CustomerCard, CustomerProfile, CustomersBoard, CustomersFilter } from './entities/customer-insights.entity';
import { customerScore, isCreditRisk, onTimePct } from './customer-insights';
import { subtractMoney, sumMoney } from '../../common/money';

const ENTITY_TYPE = 'customer';

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly customers: CustomersRepository,
    private readonly audit: AuditService,
    private readonly routes: RoutesService,
    private readonly insights: CustomerInsightsRepository,
  ) {}

  // ---- The owner's Customers list and Customer Profile (redesign Phase 5) ----

  /**
   * The Customers list: every customer with what they've bought, what they
   * owe, their score and whether they're a credit risk — the money only for
   * someone with finance:read. Filtered (all, active, credit risk, overdue),
   * by route, and searched by name, mobile, place or route.
   */
  async board(
    tenantId: string,
    query: { filter: CustomersFilter; routeId: string | null; q: string | null; page: number; pageSize: number },
    canSeeMoney: boolean,
  ): Promise<CustomersBoard> {
    const rows = await this.db.withTenant(tenantId, (client) => this.insights.figuresWithClient(client));
    const cards = rows.map((r) => cardOf(r, canSeeMoney));
    const q = query.q?.trim().toLowerCase() ?? '';
    const digits = q.replace(/\D/g, '');
    const searched = cards.filter(
      (c) =>
        (!query.routeId || c.routeId === query.routeId) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (c.place ?? '').toLowerCase().includes(q) ||
          (c.routeName ?? '').toLowerCase().includes(q) ||
          (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))),
    );
    const isCredit = (c: CustomerCard) => c.status === 'active' && c.creditRisk === true;
    const isOverdue = (c: CustomerCard) => c.status === 'active' && Number(c.overdue ?? 0) > 0;
    const counts = {
      all: searched.length,
      active: searched.filter((c) => c.status === 'active').length,
      credit: canSeeMoney ? searched.filter(isCredit).length : null,
      overdue: canSeeMoney ? searched.filter(isOverdue).length : null,
    };
    const shown = searched.filter((c) =>
      query.filter === 'active' ? c.status === 'active' : query.filter === 'credit' ? isCredit(c) : query.filter === 'overdue' ? isOverdue(c) : true,
    );
    // Overdue and at-risk customers first when filtering by money; otherwise by name.
    if (query.filter === 'overdue') shown.sort((a, b) => (b.oldestOverdueDays ?? 0) - (a.oldestOverdueDays ?? 0));
    const start = (query.page - 1) * query.pageSize;
    return {
      filter: query.filter,
      counts,
      total: shown.length,
      page: query.page,
      pageSize: query.pageSize,
      items: shown.slice(start, start + query.pageSize),
    };
  }

  /** Customer Profile: the record and where they are, their orders (orders:read), and money (finance:read). */
  async profile(tenantId: string, id: string, can: { money: boolean; orders: boolean }): Promise<CustomerProfile> {
    const customer = await this.getById(tenantId, id);
    return this.db.withTenant(tenantId, async (client) => {
      const [row] = await this.insights.figuresWithClient(client, id);
      const pin = await this.insights.pinWithClient(client, 'customer', id);
      const orders = can.orders ? await this.insights.ordersWithClient(client, id) : null;
      let money: CustomerProfile['money'] = null;
      if (can.money && row) {
        const trend = await this.insights.salesTrendWithClient(client, id);
        const margin = await this.insights.marginWithClient(client, id);
        const card = cardOf(row, true);
        const inUse = sumMoney([subtractMoney(row.outstanding, row.on_account), row.open_orders]);
        const gross = subtractMoney(margin.revenue, margin.cogs);
        money = {
          totalSales: row.sales,
          salesLast30Days: trend.last30,
          salesPrevious30Days: trend.previous30,
          outstanding: row.outstanding,
          overdue: row.overdue,
          oldestOverdueDays: row.oldest_overdue_days,
          onAccount: row.on_account,
          openOrderValue: row.open_orders,
          creditLimit: row.credit_limit,
          available: subtractMoney(row.credit_limit, inUse),
          settledInvoices: row.settled,
          avgPaymentDays: row.avg_days,
          onTimePct: onTimePct({ settled: row.settled, onTime: row.on_time }),
          score: card.score,
          creditRisk: card.creditRisk ?? false,
          revenue: margin.revenue,
          costOfGoods: margin.cogs,
          grossMargin: gross,
          grossMarginPct: Number(margin.revenue) > 0 ? Math.round((1000 * Number(gross)) / Number(margin.revenue)) / 10 : null,
          topProducts: margin.topProducts,
        };
      }
      return {
        customer,
        routeName: row?.route_name ?? null,
        pin,
        orders: orders && {
          count: orders.count,
          avgOrderValue: orders.avg_value,
          lastOrderAt: orders.last_order_at,
          recent: orders.recent,
        },
        money,
      };
    });
  }

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<CustomerRecord>> {
    return this.customers.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<CustomerRecord> {
    const customer = await this.customers.findById(tenantId, id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /**
   * For another module already inside its own transaction (Finance reads
   * payment terms and finance-charge policy while issuing an invoice) —
   * the same connection, so no second pooled client is taken mid-transaction.
   */
  async getByIdWithClient(client: PoolClient, id: string): Promise<CustomerRecord> {
    const customer = await this.customers.findByIdWithClient(client, id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(tenantId: string, actorUserId: string, dto: CreateCustomerDto): Promise<CustomerRecord> {
    if (dto.routeId) await this.routes.assertUsable(tenantId, dto.routeId);
    return this.db.withTenant(tenantId, (client) => this.createWithClient(client, tenantId, actorUserId, dto));
  }

  /** In the caller's transaction: a customer a driver met on the road, approved (D10). Routes are checked by the caller. */
  async createWithClient(client: PoolClient, tenantId: string, actorUserId: string, dto: CreateCustomerDto): Promise<CustomerRecord> {
    const created = await this.customers.createWithClient(client, tenantId, actorUserId, {
      name: dto.name,
      contact: { ...dto.contact },
      creditLimit: dto.creditLimit ?? 0,
      paymentTermsDays: dto.paymentTermsDays ?? 0,
      preferredLanguage: dto.preferredLanguage,
      place: dto.place?.trim() || null,
      address: dto.address?.trim() || null,
    });
    // Their usual route: a stop at the end of it (Routes).
    if (dto.routeId) await this.routes.placeWithClient(client, tenantId, 'customer', created.id, dto.routeId);
    const customer = dto.routeId ? ((await this.customers.findByIdWithClient(client, created.id)) ?? created) : created;
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: ENTITY_TYPE,
      entityId: customer.id,
      after: customer as unknown as Record<string, unknown>,
    });
    return customer;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerRecord> {
    if (dto.routeId) await this.routes.assertUsable(tenantId, dto.routeId);
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.customers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Customer not found');

      // Left out: kept. Sent as null or blank: cleared.
      let after = await this.customers.updateWithClient(client, id, dto.version, {
        name: dto.name,
        contact: dto.contact && { ...dto.contact },
        preferredLanguage: dto.preferredLanguage,
        ...(dto.place !== undefined && { place: dto.place?.trim() || null }),
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
      });
      if (dto.routeId !== undefined && dto.routeId !== before.routeId) {
        await this.routes.placeWithClient(client, tenantId, 'customer', id, dto.routeId);
        after = (await this.customers.findByIdWithClient(client, id)) ?? after;
      }

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  updateCreditTerms(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateCreditTermsDto,
  ): Promise<CustomerRecord> {
    return this.db.withTenant(tenantId, (client) => this.updateCreditTermsWithClient(client, tenantId, actorUserId, id, dto));
  }

  /** In the caller's transaction: a credit limit a driver asked for, approved (D10). */
  async updateCreditTermsWithClient(client: PoolClient, tenantId: string, actorUserId: string, id: string, dto: UpdateCreditTermsDto): Promise<CustomerRecord> {
    const before = await this.customers.findByIdWithClient(client, id);
    if (!before) throw new NotFoundException('Customer not found');

    // The annual rate is what's charged (÷ 365, client Q&A, finance); a
    // monthly rate from an older client converts at the same daily cost.
    const annual =
      dto.financeChargeRateAnnual ??
      (dto.financeChargeRateMonthly !== undefined ? Math.round((dto.financeChargeRateMonthly * 365 * 100) / 30) / 100 : undefined);
    const after = await this.customers.updateCreditTermsWithClient(client, id, dto.version, {
      creditLimit: dto.creditLimit,
      paymentTermsDays: dto.paymentTermsDays,
      financeChargeRateAnnual: annual,
      financeChargeRateMonthly: annual === undefined ? undefined : Math.round((annual * 30 * 100) / 365) / 100,
      financeChargeGraceDays: dto.financeChargeGraceDays,
      creditHold: dto.creditHold,
      creditHoldReason: dto.creditHoldReason ?? null,
    });

    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'update',
      entityType: ENTITY_TYPE,
      entityId: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
    return after;
  }

  archive(tenantId: string, actorUserId: string, id: string): Promise<CustomerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restore(tenantId: string, actorUserId: string, id: string): Promise<CustomerRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  /** A lost or copied QR: a new one for the shop, and the old printout no longer matches at the door. */
  newQr(tenantId: string, actorUserId: string, id: string): Promise<CustomerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.customers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Customer not found');
      const after = await this.customers.newQrWithClient(client, id);
      if (!after) throw new NotFoundException('Customer not found');
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: { qrToken: before.qrToken },
        after: { qrToken: after.qrToken },
      });
      return after;
    });
  }

  private setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<CustomerRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.customers.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Customer not found');

      const after = await this.customers.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Customer not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action,
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}

function cardOf(r: CustomerFiguresRow, canSeeMoney: boolean): CustomerCard {
  const behaviour = { settled: r.settled, onTime: r.on_time, oldestOverdueDays: r.oldest_overdue_days, creditHold: r.credit_hold };
  return {
    id: r.id,
    name: r.name,
    place: r.place,
    phone: r.phone,
    routeId: r.route_id,
    routeName: r.route_name,
    status: r.status,
    creditHold: r.credit_hold,
    totalSales: canSeeMoney ? r.sales : null,
    outstanding: canSeeMoney ? r.outstanding : null,
    overdue: canSeeMoney ? r.overdue : null,
    oldestOverdueDays: canSeeMoney ? r.oldest_overdue_days : null,
    score: canSeeMoney ? customerScore(behaviour) : null,
    creditRisk: canSeeMoney
      ? isCreditRisk({
          creditHold: r.credit_hold,
          oldestOverdueDays: r.oldest_overdue_days,
          creditLimit: Number(r.credit_limit),
          outstanding: Number(r.outstanding),
          onAccount: Number(r.on_account),
          openOrders: Number(r.open_orders),
        })
      : null,
  };
}
