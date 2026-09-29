import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { LedgerLineInput } from '../finance/repositories/ledger.repository';
import { assertRealDate } from '../../common/period';
import { fromCents, moneyFromNumber, sumMoney, toCents } from '../../common/money';
import { PayrollRepository } from './repositories/payroll.repository';
import { computeEarnings, WorkDay } from './payroll-math';
import {
  AdvanceRecord,
  AssignmentRecord,
  EarningsPreview,
  IncentiveRule,
  MinimumWageRate,
  PayrollSettings,
  SettlementRecord,
  WorkerDetail,
  WorkerRow,
} from './entities/payroll.entity';
import {
  CreateAssignmentDto,
  DraftSettlementsDto,
  IncentiveRuleDto,
  MinimumWageDto,
  PayRateDto,
  PayrollSettingsDto,
  PaySettlementDto,
  RecordAdvanceDto,
  UpdateAssignmentDto,
  VoidSettlementDto,
  WorkerProfileDto,
} from './dto/payroll.dto';

const MAX_PERIOD_DAYS = 62;

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const qty = (n: number | null | undefined, places: 2 | 3) => (n === null || n === undefined ? null : n.toFixed(places));

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Workforce management and payroll: who works (profiles and effective-dated
 * pay rates), what they did (assignments, which are also attendance), and
 * what they're owed (earnings, incentives, the minimum-wage floor, advance
 * recovery), settled per period: drafted, approved by someone other than
 * the preparer (Constitution V.2), then paid. Approval posts the labour
 * cost to the ledger in the period worked; payment clears it (Cost
 * Allocation Engine: labour is a real expense when payroll runs).
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PayrollRepository,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  private period(from: string, to: string): void {
    assertRealDate(from, 'from');
    assertRealDate(to, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    if (daysBetween(from, to) > MAX_PERIOD_DAYS) throw new BadRequestException(`A pay period covers at most ${MAX_PERIOD_DAYS} days`);
  }

  // ---- Settings ----

  getSettings(tenantId: string): Promise<PayrollSettings> {
    return this.db.withTenant(tenantId, (client) => this.repo.settings(client));
  }

  saveSettings(tenantId: string, userId: string, dto: PayrollSettingsDto): Promise<PayrollSettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.settings(client);
      const ok = await this.repo.saveSettings(client, tenantId, userId, dto.version, {
        defaultStateCode: dto.defaultStateCode ?? null,
        minWagePolicy: dto.minWagePolicy,
      });
      if (!ok) throw new ConflictException('Payroll settings were changed by someone else — reload and try again');
      const after = await this.repo.settings(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.version === 0 ? 'create' : 'update',
        entityType: 'payroll_settings',
        entityId: tenantId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Workers ----

  listWorkers(tenantId: string): Promise<WorkerRow[]> {
    return this.db.withTenant(tenantId, async (client) => this.repo.workers(client, (await this.repo.today(client)).today));
  }

  getWorker(tenantId: string, employeeId: string): Promise<WorkerDetail> {
    return this.db.withTenant(tenantId, (client) => this.workerDetail(client, employeeId));
  }

  private async workerDetail(client: PoolClient, employeeId: string): Promise<WorkerDetail> {
    const [row] = await this.repo.workers(client, (await this.repo.today(client)).today, employeeId);
    if (!row) throw new NotFoundException('Worker not found');
    return { ...row, rates: await this.repo.ratesFor(client, employeeId) };
  }

  saveProfile(tenantId: string, userId: string, employeeId: string, dto: WorkerProfileDto): Promise<WorkerDetail> {
    if (dto.joinedOn) assertRealDate(dto.joinedOn, 'joinedOn');
    if (dto.leftOn) assertRealDate(dto.leftOn, 'leftOn');
    if (dto.joinedOn && dto.leftOn && dto.leftOn < dto.joinedOn) throw new BadRequestException('The leaving date is before the joining date');
    return this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.employeeExists(client, employeeId))) throw new NotFoundException('Worker not found');
      const before = await this.workerDetail(client, employeeId);
      const ok = await this.repo.saveProfile(client, tenantId, employeeId, userId, dto.version, {
        employmentType: dto.employmentType,
        skillCategory: dto.skillCategory,
        workStateCode: dto.workStateCode ?? null,
        joinedOn: dto.joinedOn ?? null,
        leftOn: dto.leftOn ?? null,
        phone: clean(dto.phone),
      });
      if (!ok) throw new ConflictException("This worker's details were changed by someone else — reload and try again");
      const after = await this.workerDetail(client, employeeId);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.profileVersion === 0 ? 'create' : 'update',
        entityType: 'worker_profile',
        entityId: employeeId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * A new rate from a date; the one open then ends the day before. Never
   * dated inside a period already settled — that pay was computed with the
   * old rate and stays explainable by it.
   */
  addRate(tenantId: string, userId: string, employeeId: string, dto: PayRateDto): Promise<WorkerDetail> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    const unitLabel = dto.payBasis === 'piece' ? clean(dto.unitLabel) : null;
    if (dto.payBasis === 'piece' && !unitLabel) throw new BadRequestException('Say what one piece is — crate, bag, kg');
    return this.db.withTenant(tenantId, async (client) => {
      const worker = await this.repo.employeeExists(client, employeeId);
      if (!worker) throw new NotFoundException('Worker not found');
      await this.repo.lockEmployee(client, employeeId);
      const settled = await this.repo.lastSettledDay(client, employeeId);
      if (settled && dto.effectiveFrom <= settled) {
        throw new ConflictException(`Pay up to ${settled} is already settled — a new rate can start from the day after`);
      }
      const id = await this.repo.addRate(client, tenantId, userId, {
        employeeId,
        payBasis: dto.payBasis,
        rate: moneyFromNumber(dto.rate),
        unitLabel,
        effectiveFrom: dto.effectiveFrom,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'create',
        entityType: 'pay_rate',
        entityId: id,
        after: { employeeId, payBasis: dto.payBasis, rate: moneyFromNumber(dto.rate), unitLabel, effectiveFrom: dto.effectiveFrom },
      });
      return this.workerDetail(client, employeeId);
    });
  }

  // ---- Assignments ----

  listAssignments(tenantId: string, from: string, to: string, employeeId?: string): Promise<AssignmentRecord[]> {
    this.period(from, to);
    return this.db.withTenant(tenantId, (client) => this.repo.assignments(client, from, to, employeeId ?? null));
  }

  createAssignment(tenantId: string, userId: string, dto: CreateAssignmentDto): Promise<AssignmentRecord> {
    assertRealDate(dto.workDate, 'workDate');
    return this.db.withTenant(tenantId, async (client) => {
      const worker = await this.repo.employeeExists(client, dto.employeeId);
      if (!worker) throw new NotFoundException('Worker not found');
      if (worker.status !== 'active') throw new ConflictException(`${worker.name} is archived`);
      const { today } = await this.repo.today(client);
      if (dto.status !== 'planned' && dto.workDate > today) throw new BadRequestException("Work can't be recorded as done on a future date");
      await this.repo.lockEmployee(client, dto.employeeId);
      const covered = await this.repo.overlapping(client, dto.employeeId, dto.workDate, dto.workDate);
      if (covered) throw new ConflictException(`${dto.workDate} is already in settlement #${covered.settlement_number} for ${worker.name}`);
      const id = await this.repo.insertAssignment(client, tenantId, userId, {
        employeeId: dto.employeeId,
        workDate: dto.workDate,
        kind: dto.kind,
        status: dto.status,
        hours: qty(dto.hours, 2),
        units: qty(dto.units, 3),
        tripId: null,
        notes: clean(dto.notes),
      });
      const created = (await this.repo.findAssignment(client, id))!;
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'assignment', entityId: id, after: created as unknown as Record<string, unknown> });
      return created;
    });
  }

  updateAssignment(tenantId: string, userId: string, id: string, dto: UpdateAssignmentDto): Promise<AssignmentRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.findAssignment(client, id);
      if (!before) throw new NotFoundException('Assignment not found');
      if (before.settlementId) throw new ConflictException(`Already paid in settlement #${before.settlementNumber} — it can't change`);
      if (before.kind === 'trip' && dto.status !== before.status) {
        throw new ConflictException('A trip assignment follows its trip — change the trip in Logistics');
      }
      const { today } = await this.repo.today(client);
      if ((dto.status === 'completed' || dto.status === 'absent') && before.workDate > today) {
        throw new BadRequestException("Work can't be recorded as done on a future date");
      }
      const ok = await this.repo.updateAssignment(client, id, dto.version, {
        status: dto.status,
        hours: dto.hours === undefined ? before.hours : qty(dto.hours, 2),
        units: dto.units === undefined ? before.units : qty(dto.units, 3),
        notes: dto.notes === undefined ? before.notes : clean(dto.notes),
      });
      if (!ok) throw new ConflictException('This assignment was changed by someone else — reload and try again');
      const after = (await this.repo.findAssignment(client, id))!;
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'update',
        entityType: 'assignment',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * Called by Logistics when a trip completes, inside its transaction: the
   * driver's day of work, with the trip's hours and its completed stops as
   * units (so a per-stop piece rate or incentive can pay on them). Once per
   * trip and driver.
   */
  async recordTripWorkWithClient(client: PoolClient, tenantId: string, userId: string, tripId: string): Promise<void> {
    const trip = await this.repo.tripWork(client, tripId);
    if (!trip) return;
    if (await this.repo.tripAssignmentExists(client, tripId, trip.driver_employee_id)) return;
    const id = await this.repo.insertAssignment(client, tenantId, userId, {
      employeeId: trip.driver_employee_id,
      workDate: trip.work_date,
      kind: 'trip',
      status: 'completed',
      hours: trip.hours,
      units: `${trip.stops}.000`,
      tripId,
      notes: null,
    });
    await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'assignment', entityId: id, after: { tripId, ...trip } });
  }

  // ---- Rules ----

  listIncentiveRules(tenantId: string): Promise<IncentiveRule[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.incentiveRules(client));
  }

  createIncentiveRule(tenantId: string, userId: string, dto: IncentiveRuleDto): Promise<IncentiveRule[]> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    if (dto.basis !== 'per_unit' && !Number.isInteger(dto.threshold)) {
      throw new BadRequestException(dto.basis === 'attendance' ? 'The attendance threshold is a whole number of days' : 'The trip threshold is a whole number of trips');
    }
    return this.db.withTenant(tenantId, async (client) => {
      const id = await this.repo.insertIncentiveRule(client, tenantId, userId, {
        name: dto.name.trim(),
        roleType: dto.roleType ?? null,
        basis: dto.basis,
        threshold: dto.threshold.toFixed(3),
        amount: moneyFromNumber(dto.amount),
        effectiveFrom: dto.effectiveFrom,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'incentive_rule', entityId: id, after: { ...dto } });
      return this.repo.incentiveRules(client);
    });
  }

  endRule(tenantId: string, userId: string, table: 'incentive_rule' | 'minimum_wage_rate', id: string, effectiveTo: string): Promise<void> {
    assertRealDate(effectiveTo, 'effectiveTo');
    return this.db.withTenant(tenantId, async (client) => {
      const ended = await this.repo.endRule(client, table, id, effectiveTo);
      if (!ended) throw new BadRequestException('Rule not found, or it would end before it starts');
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: table, entityId: id, after: { effectiveTo } });
    });
  }

  listMinimumWages(tenantId: string): Promise<MinimumWageRate[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.minimumWages(client));
  }

  createMinimumWage(tenantId: string, userId: string, dto: MinimumWageDto): Promise<MinimumWageRate[]> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    return this.db.withTenant(tenantId, async (client) => {
      try {
        const id = await this.repo.insertMinimumWage(client, tenantId, userId, {
          stateCode: dto.stateCode,
          skillCategory: dto.skillCategory,
          dailyRate: moneyFromNumber(dto.dailyRate),
          effectiveFrom: dto.effectiveFrom,
          source: clean(dto.source),
        });
        await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'minimum_wage_rate', entityId: id, after: { ...dto } });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(`There is already a minimum wage for that state and category from ${dto.effectiveFrom}`);
        }
        throw err;
      }
      return this.repo.minimumWages(client);
    });
  }

  // ---- Advances ----

  listAdvances(tenantId: string, employeeId?: string, openOnly = false): Promise<AdvanceRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.advances(client, employeeId ?? null, openOnly));
  }

  /** Dr Advances to workers / Cr bank or cash — an asset until recovered from pay. */
  recordAdvance(tenantId: string, userId: string, dto: RecordAdvanceDto): Promise<AdvanceRecord[]> {
    assertRealDate(dto.paidOn, 'paidOn');
    const amount = moneyFromNumber(dto.amount);
    return this.db.withTenant(tenantId, async (client) => {
      const worker = await this.repo.employeeExists(client, dto.employeeId);
      if (!worker) throw new NotFoundException('Worker not found');
      if (worker.status !== 'active') throw new ConflictException(`${worker.name} is archived`);
      const { today, timezone } = await this.repo.today(client);
      if (dto.paidOn > today) throw new BadRequestException("An advance can't be dated in the future");
      const id = randomUUID();
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'worker_advance_paid',
        sourceType: 'worker_advance',
        sourceId: id,
        occurredAt: await this.instant(client, timezone, today, dto.paidOn),
        memo: `Advance to ${worker.name}${dto.notes ? ` — ${dto.notes.trim()}` : ''}`,
        createdBy: userId,
        lines: [
          { account: 'employee_advance', debit: amount },
          { account: dto.paidFrom, credit: amount },
        ],
      });
      await this.repo.insertAdvance(client, {
        id,
        tenantId,
        employeeId: dto.employeeId,
        amount,
        paidOn: dto.paidOn,
        paidFrom: dto.paidFrom,
        notes: clean(dto.notes),
        entryId,
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'worker_advance', entityId: id, after: { ...dto, amount, entryId } });
      return this.repo.advances(client, dto.employeeId, false);
    });
  }

  // ---- Earnings and settlements ----

  private async earnings(
    client: PoolClient,
    worker: WorkerRow,
    from: string,
    to: string,
    extra: { adjustments: { description: string; amount: string }[]; maxAdvanceRecovery: string | null },
    shared: { settings: PayrollSettings; incentives: IncentiveRule[]; minimumWages: MinimumWageRate[] },
  ): Promise<EarningsPreview> {
    const covered = await this.repo.overlapping(client, worker.employeeId, from, to);
    const work = await this.repo.unsettledWork(client, worker.employeeId, from, to);
    const rates = await this.repo.ratesFor(client, worker.employeeId);
    const advances = (await this.repo.advances(client, worker.employeeId, true)).map((a) => ({ id: a.id, paidOn: a.paidOn, outstanding: a.outstanding }));
    const result = computeEarnings({
      periodStart: from,
      periodEnd: to,
      roleType: worker.roleType,
      skillCategory: worker.skillCategory,
      stateCode: worker.workStateCode ?? shared.settings.defaultStateCode,
      joinedOn: worker.joinedOn,
      leftOn: worker.leftOn,
      rates,
      work: work.map<WorkDay>((a) => ({ date: a.workDate, status: a.status as WorkDay['status'], kind: a.kind, hours: a.hours, units: a.units })),
      incentiveRules: shared.incentives,
      minimumWages: shared.minimumWages,
      minWagePolicy: shared.settings.minWagePolicy,
      adjustments: extra.adjustments,
      advances,
      maxAdvanceRecovery: extra.maxAdvanceRecovery,
    });
    return {
      employeeId: worker.employeeId,
      employeeName: worker.name,
      periodStart: from,
      periodEnd: to,
      daysWorked: result.daysWorked,
      lines: result.lines,
      gross: result.gross,
      deductions: result.deductions,
      net: result.net,
      warnings: result.warnings,
      assignmentIds: work.map((a) => a.id),
      blockedBy: covered
        ? `Overlaps settlement #${covered.settlement_number} (${covered.status})`
        : rates.length === 0
          ? 'No pay rate set'
          : null,
    };
  }

  private async shared(client: PoolClient) {
    return {
      settings: await this.repo.settings(client),
      incentives: await this.repo.incentiveRules(client),
      minimumWages: await this.repo.minimumWages(client),
    };
  }

  /** What every active worker would be paid for a period, before anything is saved. */
  previewEarnings(tenantId: string, from: string, to: string): Promise<EarningsPreview[]> {
    this.period(from, to);
    return this.db.withTenant(tenantId, async (client) => {
      const shared = await this.shared(client);
      // Everyone active, plus anyone archived who left during the period (their last pay).
      const workers = (await this.repo.workers(client, to)).filter((w) => w.status === 'active' || (w.leftOn !== null && w.leftOn >= from));
      const out: EarningsPreview[] = [];
      for (const w of workers) out.push(await this.earnings(client, w, from, to, { adjustments: [], maxAdvanceRecovery: null }, shared));
      return out;
    });
  }

  /**
   * Drafts a settlement per worker for the period — the lines as the
   * preview computed them, saved, with the period's work linked so it can't
   * be paid twice. Adjustments only when drafting a single worker.
   */
  draftSettlements(tenantId: string, userId: string, dto: DraftSettlementsDto): Promise<SettlementRecord[]> {
    this.period(dto.from, dto.to);
    const ids = [...new Set(dto.employeeIds)];
    if (ids.length === 0) throw new BadRequestException('Choose at least one worker');
    if (dto.adjustments?.length && ids.length > 1) throw new BadRequestException('Adjustments apply to one worker at a time');
    return this.db.withTenant(tenantId, async (client) => {
      const { today } = await this.repo.today(client);
      if (dto.to > today) throw new BadRequestException("A pay period can't end in the future");
      const shared = await this.shared(client);
      const created: string[] = [];
      for (const id of ids) {
        await this.repo.lockEmployee(client, id);
        const [worker] = await this.repo.workers(client, dto.to, id);
        if (!worker) throw new NotFoundException('Worker not found');
        const preview = await this.earnings(
          client,
          worker,
          dto.from,
          dto.to,
          {
            adjustments: (dto.adjustments ?? []).map((a) => ({ description: a.description.trim(), amount: moneyFromNumber(a.amount) })),
            maxAdvanceRecovery: dto.maxAdvanceRecovery === undefined ? null : moneyFromNumber(dto.maxAdvanceRecovery),
          },
          shared,
        );
        if (preview.blockedBy) throw new ConflictException(`${worker.name}: ${preview.blockedBy}`);
        if (toCents(preview.gross) === 0n) throw new ConflictException(`${worker.name} earned nothing in this period — nothing to settle`);
        if (toCents(preview.net) < 0n) throw new BadRequestException(`${worker.name}: deductions exceed earnings`);
        const settlementId = randomUUID();
        await this.repo.insertSettlement(client, {
          id: settlementId,
          tenantId,
          number: await this.repo.nextSettlementNumber(client),
          employeeId: id,
          from: dto.from,
          to: dto.to,
          gross: preview.gross,
          deductions: preview.deductions,
          net: preview.net,
          warnings: preview.warnings,
          userId,
          lines: preview.lines,
        });
        await this.repo.linkAssignments(client, settlementId, preview.assignmentIds);
        await this.audit.record(client, {
          tenantId,
          actorUserId: userId,
          action: 'create',
          entityType: 'settlement',
          entityId: settlementId,
          after: { employeeId: id, from: dto.from, to: dto.to, gross: preview.gross, net: preview.net },
        });
        created.push(settlementId);
      }
      const out: SettlementRecord[] = [];
      for (const id of created) out.push(await this.settlementDetail(client, id));
      return out;
    });
  }

  listSettlements(tenantId: string, filter: { status?: string; employeeId?: string; from?: string; to?: string }): Promise<SettlementRecord[]> {
    return this.db.withTenant(tenantId, (client) =>
      this.repo.settlements(client, filter.status ?? null, filter.employeeId ?? null, filter.from ?? null, filter.to ?? null),
    );
  }

  getSettlement(tenantId: string, id: string): Promise<SettlementRecord> {
    return this.db.withTenant(tenantId, (client) => this.settlementDetail(client, id));
  }

  private async settlementDetail(client: PoolClient, id: string): Promise<SettlementRecord> {
    const s = await this.repo.findSettlement(client, id);
    if (!s) throw new NotFoundException('Settlement not found');
    const { approvalEntryId: _entry, ...rest } = s;
    return { ...rest, lines: await this.repo.settlementLines(client, id) };
  }

  /**
   * Approval posts the period's labour cost (Cost Allocation Engine: labour
   * is a real expense when payroll runs), dated the period's last day:
   *   Dr Salaries and wages   basic + minimum-wage top-up ± adjustments
   *   Dr Worker incentives    incentives
   *   Cr Advances to workers  recovered
   *   Cr Wages payable        net
   * A closed accounting period refuses it (the ledger's period lock).
   */
  approveSettlement(tenantId: string, userId: string, id: string, version: number): Promise<SettlementRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const s = await this.repo.findSettlement(client, id);
      if (!s) throw new NotFoundException('Settlement not found');
      if (s.status !== 'draft') throw new ConflictException(`Settlement #${s.settlementNumber} is ${s.status}, not a draft`);
      if (s.preparedBy === userId) throw new ForbiddenException('Someone other than the preparer has to approve a settlement');
      const lines = await this.repo.settlementLines(client, id);
      const sum = (kinds: string[]) => sumMoney(lines.filter((l) => kinds.includes(l.kind)).map((l) => l.amount));
      const wages = sum(['basic', 'minimum_wage_topup', 'adjustment']);
      const incentives = sum(['incentive']);
      const recovered = sumMoney(lines.filter((l) => l.kind === 'advance_recovery').map((l) => l.amount.replace('-', '')));
      const { today, timezone } = await this.repo.today(client);
      const ledgerLines: LedgerLineInput[] = [
        toCents(wages) >= 0n ? { account: 'salaries_wages', debit: wages } : { account: 'salaries_wages', credit: fromCents(-toCents(wages)) },
        { account: 'incentives_expense', debit: incentives },
        { account: 'employee_advance', credit: recovered },
        { account: 'wages_payable', credit: s.net },
      ];
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'payroll_accrued',
        sourceType: 'settlement',
        sourceId: id,
        occurredAt: await this.instant(client, timezone, today, s.periodEnd),
        memo: `Pay for ${s.employeeName}, ${s.periodStart} to ${s.periodEnd} (settlement #${s.settlementNumber})`,
        createdBy: userId,
        lines: ledgerLines,
      });
      const ok = await this.repo.transition(client, id, version, 'draft', {
        status: 'approved',
        approved_by: userId,
        approved_at: new Date(),
        approval_entry_id: entryId,
      });
      if (!ok) throw new ConflictException('This settlement was changed by someone else — reload and try again');
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: 'settlement', entityId: id, before: { status: 'draft' }, after: { status: 'approved', entryId } });
      return this.settlementDetail(client, id);
    });
  }

  /** Dr Wages payable / Cr bank or cash — the net handed over. Nothing to post when advances took it all. */
  paySettlement(tenantId: string, userId: string, id: string, dto: PaySettlementDto): Promise<SettlementRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const s = await this.repo.findSettlement(client, id);
      if (!s) throw new NotFoundException('Settlement not found');
      if (s.status !== 'approved') throw new ConflictException(`Settlement #${s.settlementNumber} is ${s.status} — only an approved one can be paid`);
      let entryId: string | null = null;
      if (toCents(s.net) > 0n) {
        entryId = await this.ledger.postSystemWithClient(client, {
          tenantId,
          entryType: 'payroll_paid',
          sourceType: 'settlement',
          sourceId: id,
          occurredAt: new Date(),
          memo: `Paid ${s.employeeName} — settlement #${s.settlementNumber}${dto.reference ? ` (${dto.reference.trim()})` : ''}`,
          createdBy: userId,
          lines: [
            { account: 'wages_payable', debit: s.net },
            { account: dto.paidFrom, credit: s.net },
          ],
        });
      }
      const ok = await this.repo.transition(client, id, dto.version, 'approved', {
        status: 'paid',
        paid_by: userId,
        paid_at: new Date(),
        paid_from: dto.paidFrom,
        payment_reference: clean(dto.reference),
        payment_entry_id: entryId,
      });
      if (!ok) throw new ConflictException('This settlement was changed by someone else — reload and try again');
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: 'settlement', entityId: id, before: { status: 'approved' }, after: { status: 'paid', paidFrom: dto.paidFrom, entryId } });
      return this.settlementDetail(client, id);
    });
  }

  /**
   * Voids a draft (nothing posted yet) or an approved, unpaid settlement
   * (its accrual is reversed, DE.4). Its work is released to be settled
   * again. A paid settlement can't be voided — the money has left; correct
   * it with an adjustment on the next one.
   */
  voidSettlement(tenantId: string, userId: string, id: string, dto: VoidSettlementDto): Promise<SettlementRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const s = await this.repo.findSettlement(client, id);
      if (!s) throw new NotFoundException('Settlement not found');
      if (s.status === 'paid') throw new ConflictException('A paid settlement can’t be voided — correct it with an adjustment on the next one');
      if (s.status === 'void') throw new ConflictException('Already void');
      let entryId: string | null = null;
      if (s.status === 'approved' && s.approvalEntryId) {
        const original = await client.query<{ account_code: string; debit: string; credit: string }>(
          'SELECT account_code, debit::text, credit::text FROM money.ledger_line WHERE entry_id = $1',
          [s.approvalEntryId],
        );
        entryId = await this.ledger.postManualWithClient(client, {
          tenantId,
          entryType: 'payroll_voided',
          sourceType: 'settlement',
          sourceId: id,
          reversesEntryId: s.approvalEntryId,
          occurredAt: new Date(),
          memo: `Settlement #${s.settlementNumber} voided: ${dto.reason.trim()}`,
          createdBy: userId,
          lines: original.rows.map((l) => ({ account: l.account_code, debit: l.credit, credit: l.debit })),
        });
      }
      const ok = await this.repo.transition(client, id, dto.version, s.status, {
        status: 'void',
        voided_by: userId,
        voided_at: new Date(),
        void_reason: dto.reason.trim(),
        void_entry_id: entryId,
      });
      if (!ok) throw new ConflictException('This settlement was changed by someone else — reload and try again');
      await this.repo.unlinkAssignments(client, id);
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: 'settlement', entityId: id, before: { status: s.status }, after: { status: 'void', reason: dto.reason.trim(), entryId } });
      return this.settlementDetail(client, id);
    });
  }

  /** Now, for today; otherwise noon on that date, tenant-local. */
  private async instant(client: PoolClient, timezone: string, today: string, date: string): Promise<Date> {
    if (date >= today) return new Date();
    const r = await client.query<{ at: Date }>(`SELECT ($1::date + time '12:00')::timestamp AT TIME ZONE $2 AS at`, [date, timezone]);
    return r.rows[0].at;
  }
}
