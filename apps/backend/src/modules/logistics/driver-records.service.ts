import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { WorkforceService } from '../workforce/workforce.service';
import { PayrollService } from '../workforce/payroll.service';
import { FleetService } from '../vehicles/fleet.service';
import { INCENTIVE_KINDS, INCENTIVE_LABEL } from '../workforce/trip-incentives';
import { TripIncentivesService } from './trip-incentives.service';
import { mondayOf } from './logistics.service';
import { addDays, assertRealDate } from '../../common/period';
import { sumMoney } from '../../common/money';
import { toMilli } from '../../common/quantity';
import { LogisticsService } from './logistics.service';
import { BackhaulsRepository } from './repositories/backhauls.repository';
import { SettlementRecord } from '../workforce/entities/payroll.entity';
import { TripPlanningRepository } from './repositories/trip-planning.repository';
import { DriverRecordsRepository, TripCardRow } from './repositories/driver-records.repository';
import {
  DriverApproval,
  DriverApprovals,
  DriverApprovalStatus,
  DriverExpense,
  DriverProfile,
  DriverSettlement,
  DriverTripCard,
  EarningsPeriod,
  MyEarnings,
  TripIncentives,
  DriverTripSummary,
  DriverVehicle,
  MyExpenses,
  TripHistory,
} from './entities/driver-records.entity';
import { disputeStatusOf, expenseStatusOf, handoverStatusOf, maintenanceDueOf, minutesBetween, placesOf, daysFrom } from './driver-records';

/** How far back the driver's expenses and trips go by default, and the most they can ask for. */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 184;
/** What waits on the owner, and what they decided, over this many days. */
const APPROVAL_DAYS = 60;

/**
 * The driver's own records (driver app V1, D6): their expenses and the
 * vehicle's mileage, what they raised that the owner decides, past trips
 * and one in full, the vehicle they drive, and who they are. Read-only,
 * and always the caller's own — resolved from their login, never a
 * client-supplied filter (DRV.14).
 */
@Injectable()
export class DriverRecordsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logistics: LogisticsService,
    private readonly workforce: WorkforceService,
    private readonly fleet: FleetService,
    private readonly planning: TripPlanningRepository,
    private readonly backhauls: BackhaulsRepository,
    private readonly repo: DriverRecordsRepository,
    private readonly payroll: PayrollService,
    private readonly incentives: TripIncentivesService,
  ) {}

  /** My Expenses: what the driver spent on days in the range (the last 30 by default), and the vehicle's mileage. */
  async myExpenses(tenantId: string, userId: string, from?: string, to?: string): Promise<MyExpenses> {
    const range = await this.range(tenantId, from, to);
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) return { ...range, items: [], totals: { all: '0.00', fuel: '0.00', other: '0.00' }, mileage: null };
    const rows = await this.db.withTenant(tenantId, (client) => this.repo.expensesWithClient(client, employeeId, range.from, range.to));
    const items: DriverExpense[] = rows.map(({ tripStatus, ...e }) => ({ ...e, status: expenseStatusOf(e, tripStatus) }));
    const fuel = sumMoney(items.filter((e) => e.category === 'fuel').map((e) => e.amount));
    const other = sumMoney(items.filter((e) => e.category !== 'fuel').map((e) => e.amount));
    const vehicle = await this.currentVehicle(tenantId, employeeId);
    const mileage = vehicle ? await this.fleet.mileage(tenantId, vehicle.id) : null;
    return {
      ...range,
      items,
      totals: { all: sumMoney([fuel, other]), fuel, other },
      mileage: vehicle && mileage ? { vehicleId: vehicle.id, registrationNumber: vehicle.registrationNumber, ...mileage } : null,
    };
  }

  /** Approvals: what the driver raised in the last 60 days that the owner decides, newest first. */
  async myApprovals(tenantId: string, userId: string): Promise<DriverApprovals> {
    const today = await this.db.withTenant(tenantId, (client) => this.planning.todayWithClient(client));
    const since = addDays(today, -APPROVAL_DAYS);
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    const counts: Record<DriverApprovalStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    if (!employeeId) return { since, items: [], counts };
    const rows = await this.db.withTenant(tenantId, (client) => this.repo.approvalsWithClient(client, employeeId, userId, since));
    const items: DriverApproval[] = [];
    for (const r of rows) {
      const status: DriverApprovalStatus | null =
        r.kind === 'expense'
          ? (expenseStatusOf({ needsApproval: true, decision: r.decision }, r.trip_status as NonNullable<typeof r.trip_status>) as DriverApprovalStatus)
          : r.kind === 'collection'
            ? disputeStatusOf(r.raw_status as 'open' | 'resolved' | 'withdrawn')
            : handoverStatusOf(r.trip_status as NonNullable<typeof r.trip_status>, r.review_note);
      if (!status) continue;
      counts[status] += 1;
      items.push({
        id: r.id,
        kind: r.kind,
        status,
        amount: r.amount,
        category: r.category,
        customerName: r.customer_name,
        detail: r.detail,
        tripId: r.trip_id,
        tripNumber: r.trip_number,
        at: r.at,
        decidedAt: r.decided_at,
        note: r.note,
        photos: r.photos,
      });
    }
    return { since, items, counts };
  }

  /** Trip History: the driver's trips that set off, on days in the range (the last 30 by default), newest first. */
  async myHistory(tenantId: string, userId: string, from?: string, to?: string): Promise<TripHistory> {
    const range = await this.range(tenantId, from, to);
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) return { ...range, trips: [] };
    const rows = await this.db.withTenant(tenantId, (client) => this.repo.tripCardsWithClient(client, employeeId, range.from, range.to));
    return { ...range, trips: rows.map(cardOf) };
  }

  /** Trip Details: one trip in full — the driver's own, or any for the owner. */
  async tripSummary(tenantId: string, userId: string, callerIsDispatcher: boolean, tripId: string): Promise<DriverTripSummary> {
    const trip = await this.logistics.getTrip(tenantId, userId, callerIsDispatcher, tripId);
    const stops = await this.logistics.listStops(tenantId, userId, callerIsDispatcher, tripId);
    const delivered = stops.some((s) => s.stopType === 'delivery' && s.status === 'completed');
    const collections = delivered ? await this.logistics.getTripCollections(tenantId, userId, callerIsDispatcher, tripId) : null;
    const expenses = await this.logistics.listExpenses(tenantId, userId, callerIsDispatcher, tripId);
    const { card, backhauls, closed, vehicle, incentives } = await this.db.withTenant(tenantId, async (client) => ({
      card: (await this.repo.tripCardsWithClient(client, trip.driverEmployeeId, '1970-01-01', '9999-12-31', tripId))[0],
      backhauls: await this.backhauls.listByTripWithClient(client, tripId),
      closed: trip.status === 'reconciled' ? await this.repo.closedWithClient(client, tripId) : null,
      vehicle: await this.repo.vehicleWithClient(client, trip.vehicleId),
      incentives: await this.incentives.forTripWithClient(client, trip),
    }));
    const of = (...categories: string[]) => sumMoney(expenses.filter((e) => categories.includes(e.category)).map((e) => e.amount));
    const view = card ? cardOf(card) : null;
    return {
      card: view ?? emptyCard(trip),
      trip,
      vehicle: vehicle ?? { id: trip.vehicleId, registrationNumber: trip.vehicleId, makeModel: null },
      stops,
      collections,
      backhauls,
      expenses,
      totals: {
        expenses: sumMoney(expenses.map((e) => e.amount)),
        fuel: of('fuel'),
        tolls: of('toll', 'parking'),
        kmPerLitre: view ? kmPerLitre(view.km, view.fuelLitres) : null,
      },
      closed,
      incentives,
    };
  }

  /** A trip's incentives (D7) — the driver's own trip, or any for the owner: kept at the close, else an estimate. */
  async tripIncentives(tenantId: string, userId: string, callerIsDispatcher: boolean, tripId: string): Promise<TripIncentives> {
    const trip = await this.logistics.getTrip(tenantId, userId, callerIsDispatcher, tripId);
    return this.incentives.forTrip(tenantId, trip);
  }

  /**
   * My Earnings (D7): fixed pay and each incentive over today, this week or
   * this month — the trips the owner closed as kept, those still open as an
   * estimate. Calculated from the work; the driver enters nothing.
   */
  async myEarnings(tenantId: string, userId: string, period: EarningsPeriod): Promise<MyEarnings> {
    const today = await this.db.withTenant(tenantId, (client) => this.planning.todayWithClient(client));
    const from = period === 'today' ? today : period === 'week' ? mondayOf(today) : `${today.slice(0, 8)}01`;
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    const empty: MyEarnings = { period, from, to: today, fixedPay: '0.00', lines: [], incentives: '0.00', estimated: '0.00', total: '0.00', rules: [] };
    if (!employeeId) return empty;
    const fixedPay = await this.payroll.fixedPay(tenantId, employeeId, from, today);
    const { kept, open, rules } = await this.db.withTenant(tenantId, async (client) => {
      const keptRows = await this.payroll.tripIncentivesWithClient(client, { employeeId, from, to: today });
      const openLines = [];
      for (const tripId of await this.repo.openTripsWithClient(client, employeeId, from, today)) {
        openLines.push(...((await this.incentives.workOutWithClient(client, tripId, null))?.lines ?? []).map((l) => ({ ...l, tripId })));
      }
      return { kept: keptRows, open: openLines, rules: (await this.payroll.incentiveRulesWithClient(client)).rules.filter((r) => r.enabled) };
    });
    const lines = INCENTIVE_KINDS.filter((kind) => rules.some((r) => r.kind === kind) || kept.some((k) => k.kind === kind)).map((kind) => {
      const k = kept.filter((x) => x.kind === kind);
      const o = open.filter((x) => x.kind === kind);
      const estimated = sumMoney(o.map((x) => x.amount));
      return {
        kind,
        label: INCENTIVE_LABEL[kind],
        amount: sumMoney([...k.map((x) => x.amount), estimated]),
        estimated,
        trips: new Set([...k.filter((x) => Number(x.amount) > 0).map((x) => x.tripId), ...o.filter((x) => Number(x.amount) > 0).map((x) => x.tripId)]).size,
      };
    });
    const incentives = sumMoney(lines.map((l) => l.amount));
    return {
      period,
      from,
      to: today,
      fixedPay,
      lines,
      incentives,
      estimated: sumMoney(lines.map((l) => l.estimated)),
      total: sumMoney([fixedPay, incentives]),
      rules: rules.map((r) => ({ kind: r.kind, percent: r.percent })),
    };
  }

  /** The driver's settlements (weekly pay): approved and paid ones, newest first, each with its lines. */
  async mySettlements(tenantId: string, userId: string): Promise<DriverSettlement[]> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) return [];
    return (await this.payroll.workerSettlements(tenantId, employeeId)).map(settlementOf);
  }

  /** The driver says they received a paid settlement; again changes nothing. */
  async acknowledgeSettlement(tenantId: string, userId: string, settlementId: string): Promise<DriverSettlement> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) throw new BadRequestException('Only a worker receives pay');
    return settlementOf(await this.payroll.acknowledgeReceipt(tenantId, userId, employeeId, settlementId));
  }

  /** Vehicle: the one the driver drives today (else on their latest trip) — what's due and what's in force. */
  async myVehicle(tenantId: string, userId: string): Promise<DriverVehicle | null> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) return null;
    const current = await this.currentVehicle(tenantId, employeeId);
    if (!current) return null;
    const v = await this.fleet.getVehicle(tenantId, current.id);
    const { today, km } = await this.db.withTenant(tenantId, async (client) => ({
      today: await this.planning.todayWithClient(client),
      km: await this.planning.lastOdometerWithClient(client, current.id),
    }));
    const mileage = await this.fleet.mileage(tenantId, current.id);
    return {
      id: v.vehicleId,
      registrationNumber: v.registrationNumber,
      makeModel: v.makeModel,
      manufactureYear: v.manufactureYear,
      fuelType: v.fuelType,
      ownership: v.ownership,
      status: v.status,
      fitForTrips: v.fitForTrips,
      issues: v.issues,
      currentKm: km,
      averageKmPerLitre: mileage.averageKmPerLitre,
      lastFullTank: mileage.last,
      maintenance: maintenanceDueOf(v.maintenance, km !== null ? Math.floor(Number(km)) : null, today),
      documents: v.documents.map((d) => ({
        docType: d.docType,
        validUntil: d.validUntil,
        daysLeft: d.validUntil ? daysFrom(today, d.validUntil) : null,
        state: d.state,
      })),
    };
  }

  /** Profile: who the driver is, the vehicle they drive, and who to call at the business. */
  async myProfile(tenantId: string, userId: string): Promise<DriverProfile> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    const vehicle = employeeId ? await this.currentVehicle(tenantId, employeeId) : null;
    return this.db.withTenant(tenantId, async (client) => {
      const worker = employeeId ? await this.repo.workerWithClient(client, employeeId) : null;
      return {
        employeeId,
        name: worker?.name ?? null,
        phone: worker?.phone ?? null,
        joinedOn: worker?.joined_on ?? null,
        businessName: await this.repo.businessNameWithClient(client),
        vehicle: vehicle?.registrationNumber ?? null,
        contacts: await this.repo.ownersWithClient(client),
      };
    });
  }

  /** The vehicle on today's trip, else on the driver's latest one. */
  private currentVehicle(tenantId: string, employeeId: string): Promise<{ id: string; registrationNumber: string } | null> {
    return this.db.withTenant(tenantId, async (client) => {
      const today = await this.planning.todayWithClient(client);
      return this.repo.currentVehicleWithClient(client, employeeId, today);
    });
  }

  private async range(tenantId: string, from?: string, to?: string): Promise<{ from: string; to: string }> {
    const today = await this.db.withTenant(tenantId, (client) => this.planning.todayWithClient(client));
    const end = to ?? today;
    const start = from ?? addDays(end, -(DEFAULT_DAYS - 1));
    assertRealDate(start, 'from');
    assertRealDate(end, 'to');
    if (start > end) throw new BadRequestException('"from" is after "to"');
    if (daysFrom(start, end) >= MAX_DAYS) throw new BadRequestException(`Ask for at most ${MAX_DAYS} days at a time`);
    return { from: start, to: end };
  }
}

function settlementOf(s: SettlementRecord): DriverSettlement {
  return {
    id: s.id,
    number: s.settlementNumber,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    status: s.status as DriverSettlement['status'],
    gross: s.gross,
    deductions: s.deductions,
    net: s.net,
    paidAt: s.paidAt,
    paidFrom: s.paidFrom,
    paymentReference: s.paymentReference,
    receivedAt: s.receivedAt,
    lines: (s.lines ?? []).map((l) => ({ kind: l.kind, description: l.description, amount: l.amount })),
  };
}

function cardOf(r: TripCardRow): DriverTripCard {
  return {
    id: r.id,
    number: r.number,
    day: r.day,
    status: r.status,
    routeName: r.route_name,
    places: placesOf(r.places ?? []),
    procurement: { done: r.pickups_done, total: r.pickups },
    delivery: { done: r.deliveries_done, total: r.deliveries },
    collected: r.collected,
    backhaulReceived: r.backhaul_received,
    km: r.km,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    minutes: minutesBetween(r.started_at, r.ended_at),
    fuelLitres: r.fuel_litres,
  };
}

/** A trip that never set off: nothing done yet. */
function emptyCard(trip: { id: string; number: string; plannedDate: string | null; status: DriverTripCard['status'] }): DriverTripCard {
  return {
    id: trip.id,
    number: trip.number,
    day: trip.plannedDate,
    status: trip.status,
    routeName: null,
    places: [],
    procurement: { done: 0, total: 0 },
    delivery: { done: 0, total: 0 },
    collected: '0.00',
    backhaulReceived: '0.00',
    km: null,
    startedAt: null,
    endedAt: null,
    minutes: null,
    fuelLitres: '0.000',
  };
}

/** km ÷ litres filled on the trip, 2 dp; null without both. */
export function kmPerLitre(km: string | null, litres: string): string | null {
  if (km === null) return null;
  const l = toMilli(litres);
  const k = toMilli(km);
  if (l <= 0n || k <= 0n) return null;
  const centi = (k * 100n * 2n + l) / (2n * l); // half-up
  return `${centi / 100n}.${(centi % 100n).toString().padStart(2, '0')}`;
}
