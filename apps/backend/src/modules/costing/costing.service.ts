import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { toMilli } from '../../common/quantity';
import { assertRealDate } from '../../common/period';
import { CostingRepository, StopLineRow } from './costing.repository';
import {
  allocateTrip,
  cents,
  Components,
  CostStop,
  financeCostOf,
  LOAD_COMPONENTS,
  perKg,
  rateDifference,
  RUNNING_COMPONENTS,
  rupeeDays,
  SERVICE_HISTORY_DAYS,
  sumOf,
  vehicleShare,
  verifiedServiceMinutes,
} from './costing-math';
import { contributionAt, financeByLine } from './contribution';
import { ContributionLevel, ContributionReport, CostAllocationSettings, TripCostRecord } from './costing.entity';

const MAX_RANGE_DAYS = 400;

/**
 * Cost allocation and true cost (Master Spec v3 P5; MS §34–36; the 12 fixes
 * 7–8; decision D1). A trip's cost is worked out once, when it closes, from
 * what was recorded (rule C1); shared out to what it delivered and picked up,
 * every rupee once (C2–C4); held against the standard (C5). Nothing is posted
 * — the costs are in the ledger already; this shares them out (Cost
 * Allocation Engine: "allocation is not posting").
 */
@Injectable()
export class CostingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CostingRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Called by Logistics as a trip closes, in its transaction (after the
   * driver's incentives are recorded, so they're in the running pool).
   * Idempotent: a trip already costed is left as it is (C1: never changed).
   */
  async allocateTripWithClient(client: PoolClient, tenantId: string, actorUserId: string, tripId: string, source: 'close' | 'backfill' = 'close'): Promise<void> {
    if (await this.repo.hasCostWithClient(client, tripId)) return;
    const trip = await this.repo.tripWithClient(client, tripId);
    if (!trip) throw new NotFoundException('Trip not found');
    if (!trip.reconciled) throw new ConflictException('A trip is costed when it closes');

    // ---- C1: the pools ----
    const direct = await this.repo.directCostsWithClient(client, tripId, trip.driverEmployeeId);
    const tripKmTenths =
      trip.openingKm !== null && trip.closingKm !== null && Number(trip.closingKm) > Number(trip.openingKm)
        ? toMilli(trip.closingKm) / 100n - toMilli(trip.openingKm) / 100n
        : 0n;
    const window = await this.repo.vehicleWindowWithClient(client, trip.vehicleId, trip.closedOn);
    const vehicle = vehicleShare(window.fixedCents, window.kmTenths, tripKmTenths);
    const pools: Components = { ...direct, vehicle: vehicle.share };

    // ---- C2–C4: the stops and what they carried ----
    const rows = await this.repo.stopLinesWithClient(client, tripId);
    const customers = [...new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
    const firstService = await this.repo.firstServiceWithClient(client, customers, tripId);
    const historySince = new Date(trip.closedAt.getTime() - SERVICE_HISTORY_DAYS * 86_400_000);
    const stops = toStops(rows, (customerId) => {
      const first = customerId ? firstService.get(customerId) : undefined;
      return !!first && first.getTime() <= historySince.getTime();
    });
    const pct = await this.repo.kgSharePctWithClient(client, trip.closedAt);
    const allocation = allocateTrip(pools, stops, cents(pct));

    const delivery = allocation.rows.filter((r) => r.kind === 'order_line').reduce((s, r) => s + sumOf(r.components), 0n);
    const inbound = allocation.rows.filter((r) => r.kind === 'lot').reduce((s, r) => s + sumOf(r.components), 0n);
    const unallocated = sumOf(allocation.unallocated);

    // ---- C5: actual against the standard ----
    const actual = perKg(delivery, allocation.deliveredKgMilli);
    const standard = await this.repo.standardWithClient(client, tripId, trip.routeId, trip.closedAt);
    const standardPerKg = standard ? perKg(standard.costCents, standard.kgMilli) : null;

    await this.repo.insertTripCostWithClient(
      client,
      {
        tenantId,
        tripId,
        source,
        computedBy: actorUserId,
        kgSharePct: pct,
        pools,
        tripKm: tripKmTenths > 0n ? `${tripKmTenths / 10n}.${tripKmTenths % 10n}` : null,
        ratePerKm: vehicle.ratePerKm,
        deliveredKgMilli: allocation.deliveredKgMilli,
        pickupKgMilli: allocation.pickupKgMilli,
        deliveryCost: delivery,
        inboundCost: inbound,
        unallocated,
        unallocatedReason: unallocated > 0n ? allocation.unallocatedReason : null,
        unweightedLines: allocation.unweightedLines,
        actualPerKg: actual,
        standardPerKg,
        standardBasis: standardPerKg ? (standard?.basis ?? null) : null,
        standardTrips: standardPerKg ? (standard?.trips ?? 0) : 0,
        variancePerKg: actual && standardPerKg ? rateDifference(actual, standardPerKg) : null,
      },
      allocation.rows,
    );
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: 'trip_cost',
      entityId: tripId,
      after: {
        source,
        total: sumOf(pools).toString(),
        running: sumOf(pools, RUNNING_COMPONENTS).toString(),
        load: sumOf(pools, LOAD_COMPONENTS).toString(),
        delivery: delivery.toString(),
        inbound: inbound.toString(),
        unallocated: unallocated.toString(),
        lines: allocation.rows.length,
      },
    });
  }

  async getTripCost(tenantId: string, tripId: string): Promise<TripCostRecord> {
    const cost = await this.db.withTenant(tenantId, (client) => this.repo.tripCostWithClient(client, tripId));
    if (!cost) throw new NotFoundException('This trip has no cost yet — a trip is costed when it closes');
    return cost;
  }

  /** C8: trips closed before costing existed, costed once each from what was recorded. */
  async backfill(tenantId: string, actorUserId: string): Promise<{ costed: number; tripIds: string[] }> {
    const ids = await this.db.withTenant(tenantId, (client) => this.repo.uncostedTripsWithClient(client));
    for (const id of ids) {
      // One transaction each: a trip whose records won't add up doesn't hold the others back.
      await this.db.withTenant(tenantId, (client) => this.allocateTripWithClient(client, tenantId, actorUserId, id, 'backfill'));
    }
    return { costed: ids.length, tripIds: ids };
  }

  /** C6: the contribution hierarchy at one level, over sale invoices issued from `from` to `to`. */
  contribution(tenantId: string, level: ContributionLevel, from: string, to: string): Promise<ContributionReport> {
    assertRealDate(from, 'from');
    assertRealDate(to, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new BadRequestException(`A range covers at most ${MAX_RANGE_DAYS} days`);
    return this.db.withTenant(tenantId, async (client) => {
      const lines = await this.repo.lineFactsWithClient(client, from, to);
      const extras = await this.repo.extraCostsWithClient(client, from, to);
      const today = await this.repo.todayWithClient(client);
      const rate = await this.repo.costOfCapitalWithClient(client);
      const currency = (await client.query<{ currency: string }>('SELECT currency FROM tenant.tenant WHERE id = current_tenant_id()')).rows[0]?.currency ?? 'INR';
      // MS §31: what each order's money cost to wait for, from its invoice until paid (or today).
      const finance = new Map<string, bigint>();
      for (const inv of await this.repo.invoiceFinanceWithClient(client, [...new Set(lines.map((l) => l.invoice_id))])) {
        const days = rupeeDays(
          { amountCents: cents(inv.amount), issuedOn: inv.issued_on, reductions: inv.reductions.map((x) => ({ on: x.on, cents: BigInt(x.cents) })) },
          today,
        );
        finance.set(inv.invoice_id, financeCostOf(days, rate));
      }
      const { rows, totals } = contributionAt(level, lines, extras, financeByLine(lines, finance));
      return {
        level,
        from,
        to,
        currency,
        costOfCapitalPct: rate,
        rows,
        totals,
        uncostedLines: lines.filter((l) => l.trip_id === null).length,
      };
    });
  }

  settings(tenantId: string): Promise<CostAllocationSettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const history = await this.repo.settingsWithClient(client);
      return { kgSharePct: history[0]?.kgSharePct ?? '50.00', history };
    });
  }

  /** D1's split, dated: trips that close from now on use it; trips already costed keep theirs. */
  setKgShare(tenantId: string, actorUserId: string, dto: { kgSharePct: number; note?: string }): Promise<CostAllocationSettings> {
    if (!(dto.kgSharePct >= 0 && dto.kgSharePct <= 100)) throw new BadRequestException('The KG share is a percentage, 0–100');
    return this.db.withTenant(tenantId, async (client) => {
      const pct = dto.kgSharePct.toFixed(2);
      await this.repo.insertSettingWithClient(client, tenantId, pct, actorUserId, dto.note?.trim() || null);
      await this.audit.record(client, { tenantId, actorUserId, action: 'update', entityType: 'cost_allocation_setting', entityId: tenantId, after: { kgSharePct: pct } });
      const history = await this.repo.settingsWithClient(client);
      return { kgSharePct: history[0]?.kgSharePct ?? pct, history };
    });
  }
}

/** The repository's rows as the allocation's stops: order lines on deliveries, lots on pickups. */
export function toStops(rows: StopLineRow[], hasHistory: (customerId: string | null) => boolean): CostStop[] {
  const stops = new Map<string, CostStop>();
  for (const r of rows) {
    const stop =
      stops.get(r.stop_id) ??
      ({
        stopId: r.stop_id,
        kind: r.stop_type,
        customerId: r.customer_id,
        serviceMinutes: r.stop_type === 'delivery' ? verifiedServiceMinutes(r.arrived_at, r.completed_at) : null,
        customerHasHistory: r.stop_type === 'delivery' && hasHistory(r.customer_id),
        lines: [],
      } as CostStop);
    stop.lines.push({
      key: r.key,
      kind: r.stop_type === 'delivery' ? 'order_line' : 'lot',
      productId: r.product_id,
      kgMilli: r.kg === null ? null : toMilli(r.kg),
      valueCents: cents(r.value),
    });
    stops.set(r.stop_id, stop);
  }
  return [...stops.values()];
}

