import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { assertRealDate } from '../../common/period';
import { moneyFromNumber, sumMoney } from '../../common/money';
import { AiRepository } from './repositories/ai.repository';
import { AiDataRepository } from './repositories/ai-data.repository';
import { ChannelsConfig } from './channels/channels.config';
import { ChannelsRepository } from './channels/channels.repository';
import {
  AiSettings,
  CallItem,
  CallList,
  CustomerProfitReport,
  PricingBoard,
  PricingRow,
  DECIDE_PERMISSION,
  Draft,
  RECOMMENDATION_TYPES,
  RecommendationRecord,
  RecommendationType,
  RunSummary,
  Scorecard,
} from './entities/ai.entity';
import {
  customerProfits,
  customerTerms,
  exceptions,
  logisticsLoad,
  logisticsRoute,
  orders,
  pricing,
  procurement,
  ProducerContext,
  productInputs,
  Suppressed,
} from './producers';
import { addDays, backtest, DailySeries } from './math/forecast';
import { costBuildUp, marginAt, priceStanding } from './math/pricing';
import { AiSettingsDto, DecideRecommendationDto } from './dto/ai.dto';
import { clampPageSize, PaginatedResult } from '../../common/persistence/pagination';

export interface AiActor {
  tenantId: string;
  userId: string;
  permissions: string[];
}

const MAX_RANGE_DAYS = 366;

/** Stable JSON for comparing what was submitted with what was proposed. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  if (typeof v === 'number') return JSON.stringify(String(v));
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return JSON.stringify(String(Number(v)));
  return JSON.stringify(v ?? null);
}

/**
 * The AI: recommends; the owner decides (AI System design; Constitution
 * VIII). Computations run in a read-only transaction as the SELECT-only
 * morbeez_ai role — the database refuses any write they attempt (DR.1).
 * The only writes are to the ai schema: runs, recommendations, and the
 * owner's decisions. Acting on a recommendation happens elsewhere, through
 * the ordinary endpoint under the owner's own session (DR.3); the decision
 * recorded here says what was done.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AiRepository,
    private readonly data: AiDataRepository,
    private readonly audit: AuditService,
    private readonly channels?: ChannelsConfig,
    private readonly channelsRepo?: ChannelsRepository,
  ) {}

  // ---- Settings ----

  getSettings(tenantId: string): Promise<AiSettings> {
    return this.db.withTenant(tenantId, (client) => this.repo.settings(client));
  }

  saveSettings(tenantId: string, userId: string, dto: AiSettingsDto): Promise<AiSettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.settings(client);
      const ok = await this.repo.saveSettings(client, tenantId, userId, dto.version, {
        targetMarginPct: dto.targetMarginPct.toFixed(2),
        maxPriceMovePct: dto.maxPriceMovePct.toFixed(2),
        minCustomerMarginPct: dto.minCustomerMarginPct.toFixed(2),
        costOfCapitalPct: dto.costOfCapitalPct.toFixed(2),
        defaultCostPerKm: dto.defaultCostPerKm.toFixed(2),
        disabledTypes: dto.disabledTypes,
      });
      if (!ok) throw new ConflictException('AI settings were changed by someone else — reload and try again');
      const after = await this.repo.settings(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.version === 0 ? 'create' : 'update',
        entityType: 'ai_settings',
        entityId: tenantId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Running ----

  /** The tenant's calendar and the end of the days recommendations expire on. */
  private async context(client: PoolClient, settings: AiSettings): Promise<ProducerContext> {
    const books = await this.data.books(client);
    const offsets = [0, 1, 6, 13];
    const ends = await client.query<{ d: string; at: Date }>(
      `SELECT d::text, ((d + 1)::timestamp AT TIME ZONE $2) AS at FROM unnest($1::date[]) AS d`,
      [offsets.map((o) => addDays(books.today, o)), books.timezone],
    );
    const endOf = new Map(ends.rows.map((r) => [r.d, r.at]));
    return {
      client,
      data: this.data,
      settings,
      today: books.today,
      tomorrow: addDays(books.today, 1),
      tz: books.timezone,
      now: new Date(),
      endOf: (date: string) => {
        const at = endOf.get(date);
        if (!at) throw new Error(`No end-of-day computed for ${date}`);
        return at;
      },
    };
  }

  /**
   * Computes fresh recommendations of every type the tenant hasn't switched
   * off. Each producer runs in its own savepoint: one that fails, or has
   * too little to go on, is recorded as suppressed and the others still
   * run (PIPE.6). Open recommendations of the types that ran are superseded.
   */
  async run(actor: AiActor): Promise<RunSummary> {
    const startedAt = new Date();
    const settings = await this.getSettings(actor.tenantId);
    const suppressed: Record<string, string> = {};
    const drafts: Draft[] = [];
    const enabled = RECOMMENDATION_TYPES.filter((t) => {
      if (settings.disabledTypes.includes(t)) suppressed[t] = 'Switched off in AI settings';
      return !settings.disabledTypes.includes(t);
    });

    await this.db.withTenantReadOnly(actor.tenantId, 'morbeez_ai', async (client) => {
      const ctx = await this.context(client, settings);
      const guarded = async (types: RecommendationType[], work: () => Promise<Draft[]>) => {
        const live = types.filter((t) => enabled.includes(t));
        if (!live.length) return;
        await client.query('SAVEPOINT producer');
        try {
          drafts.push(...(await work()).filter((d) => live.includes(d.type)));
          await client.query('RELEASE SAVEPOINT producer');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT producer');
          const why = err instanceof Suppressed ? err.message : `Could not compute: ${(err as Error).message}`;
          for (const t of live) suppressed[t] = why;
        }
      };
      let inputs: Awaited<ReturnType<typeof productInputs>> | null = null;
      await guarded(['procurement', 'pricing'], async () => {
        inputs = await productInputs(ctx);
        return [];
      });
      if (inputs) {
        await guarded(['procurement'], () => procurement(ctx, inputs!));
        await guarded(['pricing'], () => pricing(ctx, inputs!));
      }
      await guarded(['logistics_route'], () => logisticsRoute(ctx));
      await guarded(['logistics_load'], () => logisticsLoad(ctx));
      await guarded(['customer_terms'], () => customerTerms(ctx));
      await guarded(['exception'], () => exceptions(ctx));
      await guarded(['order'], () => orders(ctx));
    });

    const produced: Record<string, number> = {};
    for (const t of enabled) produced[t] = drafts.filter((d) => d.type === t).length;
    const runId = randomUUID();
    await this.db.withTenant(actor.tenantId, async (client) => {
      await this.repo.lockRuns(client);
      await this.repo.insertRun(client, { id: runId, tenantId: actor.tenantId, startedAt, produced, suppressed, userId: actor.userId });
      await this.repo.expireOpen(client, actor.tenantId, enabled);
      for (const d of drafts) await this.repo.insert(client, actor.tenantId, runId, d);
      await this.audit.record(client, { tenantId: actor.tenantId, actorUserId: actor.userId, action: 'create', entityType: 'ai_run', entityId: runId, after: { produced, suppressed } });
    });
    return { runId, startedAt, finishedAt: new Date(), produced, suppressed, byEmail: null };
  }

  lastRun(tenantId: string): Promise<RunSummary | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const r = await this.repo.lastRun(client);
      return r ? { runId: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, produced: r.produced, suppressed: r.suppressed, byEmail: r.byEmail } : null;
    });
  }

  // ---- Inbox ----

  /** Flags about people are shown only to those who may decide them (AISEC.8). */
  private seesSensitive(actor: AiActor): boolean {
    return actor.permissions.includes(DECIDE_PERMISSION.exception);
  }

  private async named(tenantId: string, recs: RecommendationRecord[]): Promise<RecommendationRecord[]> {
    if (!recs.length) return recs;
    const names = await this.db.withTenantReadOnly(tenantId, 'morbeez_ai', (client) => this.data.names(client));
    return recs.map((r) => ({ ...r, subjectName: r.subjectId ? names.get(r.subjectId) ?? null : null }));
  }

  async list(
    actor: AiActor,
    q: { status?: 'open' | 'decided' | 'all'; type?: RecommendationType; page?: number; pageSize?: number },
  ): Promise<PaginatedResult<RecommendationRecord>> {
    const page = q.page ?? 1;
    const pageSize = clampPageSize(q.pageSize);
    const { recs, total } = await this.db.withTenant(actor.tenantId, (client) =>
      this.repo.list(client, {
        status: q.status ?? 'open', type: q.type ?? null, includeSensitive: this.seesSensitive(actor), since: null,
        limit: pageSize, offset: (page - 1) * pageSize,
      }),
    );
    return { items: await this.named(actor.tenantId, recs), total, page, pageSize };
  }

  async get(actor: AiActor, id: string): Promise<RecommendationRecord> {
    const rec = await this.db.withTenant(actor.tenantId, (client) => this.repo.find(client, id));
    if (!rec || (rec.sensitive && !this.seesSensitive(actor))) throw new NotFoundException('Suggestion not found');
    return (await this.named(actor.tenantId, [rec]))[0];
  }

  /**
   * Records what the owner did (DR.4). Only someone holding the type's
   * decide permission may — the owner, or a role the owner delegated it to
   * (DR.2). Acting on it is recorded as accepted when what was submitted
   * matches the proposal, modified when it doesn't.
   */
  async decide(actor: AiActor, id: string, dto: DecideRecommendationDto): Promise<RecommendationRecord> {
    const reason = dto.reason?.trim() || null;
    if (dto.outcome === 'dismissed' && !reason) throw new BadRequestException('Say why it was dismissed');
    return this.db.withTenant(actor.tenantId, async (client) => {
      const rec = await this.repo.find(client, id);
      if (!rec || (rec.sensitive && !this.seesSensitive(actor))) throw new NotFoundException('Suggestion not found');
      if (!actor.permissions.includes(DECIDE_PERMISSION[rec.type])) {
        throw new ForbiddenException(`Deciding ${rec.type.replace('_', ' ')} suggestions is the owner's, or whoever the owner gave ${DECIDE_PERMISSION[rec.type]}`);
      }
      if (rec.decision) throw new ConflictException(`Already ${rec.decision.decision}`);
      if (new Date(rec.expiresAt) <= new Date()) throw new ConflictException('This suggestion has expired — ask for fresh ones');
      let decision: 'accepted' | 'modified' | 'dismissed' = 'dismissed';
      if (dto.outcome === 'acted') {
        const compare = (rec.proposal as { compare?: Record<string, unknown> }).compare;
        if (!compare || !Object.keys(compare).length) decision = 'accepted';
        else {
          if (!dto.submitted) throw new BadRequestException('Send what was submitted, to compare with the suggestion');
          const picked = Object.fromEntries(Object.keys(compare).map((k) => [k, dto.submitted![k]]));
          decision = canonical(picked) === canonical(compare) ? 'accepted' : 'modified';
        }
      }
      const ok = await this.repo.decide(client, { tenantId: actor.tenantId, id, decision, userId: actor.userId, submitted: dto.submitted, reason, resultRef: dto.resultRef });
      if (!ok) throw new ConflictException('Someone decided this a moment ago');
      await this.audit.record(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'update',
        entityType: 'ai_recommendation',
        entityId: id,
        before: { status: 'open' },
        after: { decision, reason, resultRef: dto.resultRef ?? null },
      });
      return (await this.repo.find(client, id))!;
    }).then((r) => this.named(actor.tenantId, [r]).then((x) => x[0]));
  }

  // ---- Evaluation (AI System EVAL.1, EVAL.4, EVAL.7) ----

  async scorecard(actor: AiActor): Promise<Scorecard> {
    const since = new Date(Date.now() - 28 * 86_400_000);
    const { counts, past } = await this.db.withTenant(actor.tenantId, async (client) => {
      const today = (await this.data.books(client)).today;
      return {
        counts: await this.repo.outcomeCounts(client, since, this.seesSensitive(actor)),
        past: await this.repo.pastForecasts(client, today, addDays(today, -56)),
      };
    });
    return this.db.withTenantReadOnly(actor.tenantId, 'morbeez_ai', async (client) => {
      const books = await this.data.books(client);
      const rows = await this.data.dailySales(client, books.timezone, addDays(books.today, -90), books.today);
      const sold = new Map<string, number>();
      const series = new Map<string, DailySeries>();
      for (const r of rows) {
        sold.set(`${r.product_id}:${r.day}`, Number(r.qty));
        const s = series.get(r.product_id) ?? new Map();
        s.set(r.day, Number(r.qty));
        series.set(r.product_id, s);
      }
      // Buying: forecast against what sold, split by whether the owner followed it.
      const wape = (list: { f: number; a: number }[]) => {
        const a = list.reduce((s, x) => s + x.a, 0);
        return a > 0 ? Math.round((list.reduce((s, x) => s + Math.abs(x.f - x.a), 0) / a) * 1000) / 1000 : null;
      };
      const buying = past
        .filter((p) => p.type === 'procurement')
        .map((p) => ({ f: Number((p.proposal as { demand: string }).demand), a: sold.get(`${p.product_id}:${p.target_date}`) ?? 0, followed: ['accepted', 'modified'].includes(p.decision as string) }));
      // The baseline itself, backtested on each product's last 28 days.
      const firsts = await this.data.firstSales(client, books.timezone);
      let err = 0;
      let actual = 0;
      let signed = 0;
      let products = 0;
      for (const [productId, s] of series) {
        const b = backtest(s, addDays(books.today, -1), 28, firsts.get(productId) ?? null);
        if (b.wape === null) continue;
        const total = Array.from({ length: 28 }, (_, i) => s.get(addDays(books.today, -1 - i)) ?? 0).reduce((x, y) => x + y, 0);
        err += b.wape * total;
        signed += (b.bias ?? 0) * total;
        actual += total;
        products++;
      }
      // Price: what was realized on the day against what was suggested and taken.
      const priced = past.filter((p) => p.type === 'pricing' && ['accepted', 'modified'].includes(p.decision as string));
      const diffs: number[] = [];
      for (const p of priced) {
        const realized = await this.data.realizedPrices(client, books.timezone, p.target_date as string, p.target_date as string);
        const r = realized.get(p.product_id as string);
        const suggested = Number((p.proposal as { price: string }).price);
        if (r && suggested > 0) diffs.push((Number(r.average) - suggested) / suggested);
      }
      return {
        since: since.toISOString().slice(0, 10),
        byType: counts.map((c) => ({ type: c.type as RecommendationType, shown: c.shown as number, accepted: c.accepted as number, modified: c.modified as number, dismissed: c.dismissed as number, expired: c.expired as number, open: c.open as number })),
        buying: {
          scored: buying.length,
          wapeFollowed: wape(buying.filter((b) => b.followed)),
          wapeNotFollowed: wape(buying.filter((b) => !b.followed)),
          withinTenPct: buying.filter((b) => b.a > 0 && Math.abs(b.f - b.a) / b.a <= 0.1).length,
          backtest: {
            wape: actual > 0 ? Math.round((err / actual) * 1000) / 1000 : null,
            bias: actual > 0 ? Math.round((signed / actual) * 1000) / 1000 : null,
            days: 28,
            products,
          },
        },
        pricing: { scored: diffs.length, realizedVsSuggestedPct: diffs.length ? Math.round((diffs.reduce((s, x) => s + x, 0) / diffs.length) * 10_000) / 100 : null },
      };
    });
  }

  // ---- AI Pricing and AI Calling (owner Phase 8) ----

  /**
   * Each active product's price against what it costs to sell (requirements
   * Part 15): the free stock's cost, what spoilage usually takes, delivery
   * per kilo over the last 30 days, the owner's target margin — and the open
   * price suggestion, which the owner acts on as anywhere else (DR.3).
   */
  async pricing(actor: AiActor): Promise<PricingBoard> {
    const settings = await this.getSettings(actor.tenantId);
    const open = await this.db.withTenant(actor.tenantId, (client) =>
      this.repo.list(client, { status: 'open', type: 'pricing', includeSensitive: false, since: null, limit: 200, offset: 0 }),
    );
    const suggestion = new Map(open.recs.filter((r) => r.subjectId).map((r) => [r.subjectId as string, r.id]));
    return this.db.withTenantReadOnly(actor.tenantId, 'morbeez_ai', async (client) => {
      const books = await this.data.books(client);
      const from = addDays(books.today, -29);
      const products = await this.data.products(client);
      const free = await this.data.freeStock(client);
      const shrink = await this.data.shrinkRates(client, new Date(Date.now() - 56 * 86_400_000));
      const realized = await this.data.realizedPrices(client, books.timezone, addDays(books.today, -13), books.today);
      const delivery = await this.data.deliveryCost(client, books.timezone, from, books.today);
      const perKg = Number(delivery.kg) > 0 ? moneyFromNumber(Number(delivery.cost) / Number(delivery.kg)) : null;
      const rank: Record<PricingRow['standing'], number> = { below_cost: 0, no_price: 1, below_sustainable: 2, below_target: 3, on_target: 4, no_cost: 5 };
      const rows: PricingRow[] = products.map((p) => {
        const stock = free.get(p.id);
        const b = stock?.unitCost
          ? costBuildUp({ unitCost: stock.unitCost, shrinkRate: shrink.get(p.id) ?? 0, deliveryPerUnit: p.uom === 'kg' ? perKg : null, targetMarginPct: settings.targetMarginPct })
          : null;
        return {
          productId: p.id,
          name: p.name,
          uom: p.uom,
          currentPrice: p.base_price,
          stockQty: stock?.qty ?? null,
          unitCost: stock?.unitCost ?? null,
          buildUp: b ? { shrinkRate: b.shrinkRate, spoilage: b.spoilage, delivery: b.delivery, sustainable: b.sustainable, target: b.target } : null,
          standing: p.base_price === null ? 'no_price' : priceStanding(p.base_price, b),
          marginPct: b && p.base_price !== null ? marginAt(p.base_price, b.sustainable) : null,
          realized: realized.get(p.id) ?? null,
          suggestionId: suggestion.get(p.id) ?? null,
        };
      });
      rows.sort((a, b) => rank[a.standing] - rank[b.standing] || a.name.localeCompare(b.name));
      return {
        asOf: books.today,
        currency: books.currency,
        targetMarginPct: settings.targetMarginPct,
        deliveryPerKg: perKg,
        deliveryWindow: { from, to: books.today, cost: delivery.cost, kg: delivery.kg },
        rows,
      };
    });
  }

  /**
   * Today's calls (requirements Part 21–23): money fallen due — as Collections
   * counts it, for those who see the money — customers whose usual order
   * hasn't come, and orders to confirm. AI voice calls are not built: the
   * owner makes these, from this list. Phones are read at request time (PIPE.5).
   */
  async calls(actor: AiActor): Promise<CallList> {
    const { open, callsEnabled } = await this.db.withTenant(actor.tenantId, async (client) => ({
      open: await this.repo.list(client, { status: 'open', type: 'order', includeSensitive: false, since: null, limit: 200, offset: 0 }),
      callsEnabled: this.channelsRepo ? (await this.channelsRepo.settings(client)).callsEnabled : false,
    }));
    const voice: CallList['voice'] = !this.channels?.callsReady ? 'not_set_up' : callsEnabled ? 'ready' : 'off';
    return this.db.withTenantReadOnly(actor.tenantId, 'morbeez_ai', async (client) => {
      const books = await this.data.books(client);
      const due = actor.permissions.includes('finance:read') ? await this.data.dueCustomers(client, 30) : [];
      const recs = open.recs.filter((r) => r.subjectId);
      const contacts = await this.data.customerContacts(client, [...new Set([...due.map((d) => d.customer_id), ...recs.map((r) => r.subjectId as string)])]);
      const person = (id: string) => contacts.get(id) ?? null;
      const calls: CallItem[] = [];
      for (const d of due) {
        const c = person(d.customer_id);
        if (c) calls.push({ kind: 'payment', customerId: d.customer_id, ...c, amount: d.due_now, dueDate: d.due_date, overdueDays: d.overdue_days, recommendationId: null, about: null });
      }
      for (const kind of ['order', 'quantity'] as const) {
        // An order the customer sent on WhatsApp is the owner's to place, not a call to make.
        for (const r of recs.filter((x) => x.proposal.action === (kind === 'order' ? 'delivery_order' : 'confirm_order') && x.proposal.source !== 'whatsapp')) {
          const c = person(r.subjectId as string);
          if (c) calls.push({ kind, customerId: r.subjectId as string, ...c, amount: r.expectedImpact, dueDate: null, overdueDays: null, recommendationId: r.id, about: r.title });
        }
      }
      return { voice, date: books.today, calls };
    });
  }

  // ---- Customer profitability ----

  async profitability(actor: AiActor, from: string, to: string): Promise<CustomerProfitReport> {
    assertRealDate(from, 'from');
    assertRealDate(to, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new BadRequestException(`A range covers at most ${MAX_RANGE_DAYS} days`);
    const settings = await this.getSettings(actor.tenantId);
    return this.db.withTenantReadOnly(actor.tenantId, 'morbeez_ai', async (client) => {
      const ctx = await this.context(client, settings);
      const books = await this.data.books(client);
      const rows = (await customerProfits(ctx, from, to)).sort((a, b) => Number(a.contribution) - Number(b.contribution));
      const total = (k: 'revenue' | 'grossMargin' | 'deliveryCost' | 'creditCost' | 'contribution') => sumMoney(rows.map((r) => r[k]));
      return {
        from,
        to,
        currency: books.currency,
        costOfCapitalPct: settings.costOfCapitalPct,
        rows: rows.map((r) => ({
          customerId: r.customerId,
          customerName: r.name,
          invoices: r.invoices,
          revenue: r.revenue,
          cogs: r.cogs,
          grossMargin: r.grossMargin,
          grossMarginPct: r.grossMarginPct,
          deliveryCost: r.deliveryCost,
          creditCost: r.creditCost,
          crateLossesAbsorbed: r.crateLossesAbsorbed,
          financeChargeIncome: r.financeChargeIncome,
          crateRecoveries: r.crateRecoveries,
          contribution: r.contribution,
          contributionPct: r.contributionPct,
          averageDaysToPay: r.averageDaysToPay,
          paymentTermsDays: r.paymentTermsDays,
        })),
        totals: { revenue: total('revenue'), grossMargin: total('grossMargin'), deliveryCost: total('deliveryCost'), creditCost: total('creditCost'), contribution: total('contribution') },
      };
    });
  }
}
