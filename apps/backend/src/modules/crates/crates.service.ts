import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { ReceivablesService } from '../finance/receivables.service';
import { PayablesService } from '../finance/payables.service';
import { assertRealDate } from '../../common/period';
import { moneyFromNumber, multiplyToMoney, sumMoney } from '../../common/money';
import { CratesRepository } from './repositories/crates.repository';
import { daysBetween, earliest, oldestOutstanding, overdueSeverity } from './crates-math';
import {
  CrateAlert,
  CrateOverview,
  CrateSettings,
  CrateType,
  HolderDetail,
  HolderKind,
  Holding,
  LossRecord,
  MovementKind,
  MovementRecord,
  TripCrates,
} from './entities/crates.entity';
import {
  CrateLimitDto,
  CrateSettingsDto,
  CreateCrateTypeDto,
  RecordLossDto,
  RecordMovementDto,
  StopCountsDto,
  UpdateCrateTypeDto,
} from './dto/crates.dto';

type Row = Record<string, unknown>;
type Books = { today: string; timezone: string; currency: string };
type Side = { kind: string; id: string | null };

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const HOLDER_LABEL: Record<HolderKind, string> = { yard: 'The yard', customer: 'This customer', farmer: 'This farmer', vehicle: 'This vehicle' };
const MAX_RANGE_DAYS = 366;

/**
 * Crate management: the business's returnable crates, wherever they are —
 * in the yard, with customers and farmers, on vehicles — kept as an
 * append-only ledger of movements between holders (Constitution III.3),
 * so a balance is always the sum of what moved and a crate is never
 * created or lost silently. Lost crates are written off with a reason and,
 * for a customer or farmer, charged at the crate's replacement cost:
 * invoiced to the customer or deducted from what the farmer is owed, both
 * through Finance in the same transaction (DE.1). Every write runs under a
 * per-tenant lock and is refused if it would take any holder below zero.
 */
@Injectable()
export class CratesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CratesRepository,
    private readonly ledger: LedgerService,
    private readonly receivables: ReceivablesService,
    private readonly payables: PayablesService,
    private readonly audit: AuditService,
  ) {}

  // ---- Settings, types, limits ----

  getSettings(tenantId: string): Promise<CrateSettings> {
    return this.db.withTenant(tenantId, (client) => this.repo.settings(client));
  }

  saveSettings(tenantId: string, userId: string, dto: CrateSettingsDto): Promise<CrateSettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.settings(client);
      const ok = await this.repo.saveSettings(client, tenantId, userId, dto.version, {
        customerOverdueDays: dto.customerOverdueDays,
        farmerOverdueDays: dto.farmerOverdueDays,
      });
      if (!ok) throw new ConflictException('Crate settings were changed by someone else — reload and try again');
      const after = await this.repo.settings(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.version === 0 ? 'create' : 'update',
        entityType: 'crate_settings',
        entityId: tenantId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  listTypes(tenantId: string): Promise<CrateType[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.types(client));
  }

  createType(tenantId: string, userId: string, dto: CreateCrateTypeDto): Promise<CrateType[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const code = dto.code.trim().toUpperCase();
      try {
        const id = await this.repo.insertType(client, {
          tenantId,
          code,
          name: dto.name.trim(),
          capacityKg: dto.capacityKg !== undefined ? dto.capacityKg.toFixed(2) : null,
          replacementCost: moneyFromNumber(dto.replacementCost),
          hsnCode: dto.hsnCode ?? null,
          reorderLevel: dto.reorderLevel ?? 0,
          userId,
        });
        await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'crate_type', entityId: id, after: { ...dto, code } });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new ConflictException(`There is already a crate type ${code}`);
        throw err;
      }
      return this.repo.types(client);
    });
  }

  updateType(tenantId: string, userId: string, id: string, dto: UpdateCrateTypeDto): Promise<CrateType[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.findType(client, id);
      if (!before) throw new NotFoundException('Crate type not found');
      const ok = await this.repo.updateType(client, id, dto.version, {
        name: dto.name.trim(),
        capacityKg: dto.capacityKg === undefined ? before.capacityKg : dto.capacityKg === null ? null : dto.capacityKg.toFixed(2),
        replacementCost: moneyFromNumber(dto.replacementCost),
        hsnCode: dto.hsnCode === undefined ? before.hsnCode : dto.hsnCode,
        reorderLevel: dto.reorderLevel,
        isActive: dto.isActive,
      });
      if (!ok) throw new ConflictException('This crate type was changed by someone else — reload and try again');
      const after = await this.repo.findType(client, id);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'update',
        entityType: 'crate_type',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return this.repo.types(client);
    });
  }

  setLimit(tenantId: string, userId: string, dto: CrateLimitDto): Promise<Holding> {
    return this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.holderName(client, dto.holderKind, dto.holderId))) throw new NotFoundException(`${dto.holderKind === 'customer' ? 'Customer' : 'Farmer'} not found`);
      await this.repo.setLimit(client, tenantId, userId, dto.holderKind, dto.holderId, dto.maxCrates ?? null);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'update',
        entityType: 'crate_limit',
        entityId: dto.holderId,
        after: { holderKind: dto.holderKind, maxCrates: dto.maxCrates ?? null },
      });
      return this.holding(client, dto.holderKind, dto.holderId);
    });
  }

  // ---- Balances ----

  /** Pick-list for crate forms — without needing customers:read or farmers:read. */
  listParties(tenantId: string): Promise<{ customers: { id: string; name: string }[]; farmers: { id: string; name: string }[]; vehicles: { id: string; name: string }[] }> {
    return this.db.withTenant(tenantId, async (client) => {
      const rows = await this.repo.parties(client);
      const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ id: r.id, name: r.name }));
      return { customers: of('customer'), farmers: of('farmer'), vehicles: of('vehicle') };
    });
  }

  listHoldings(tenantId: string, kind?: HolderKind): Promise<Holding[]> {
    return this.db.withTenant(tenantId, (client) => this.holdings(client, kind ?? null, null));
  }

  getHolder(tenantId: string, kind: HolderKind, id: string | null): Promise<HolderDetail> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const holding = await this.holding(client, kind, id);
      return {
        ...holding,
        movements: await this.repo.movements(client, { timezone: books.timezone, from: null, to: null, holderKind: kind, holderId: id, tripId: null, batchId: null, limit: 200 }),
        losses: await this.repo.losses(client, { timezone: books.timezone, from: null, to: null, holderKind: kind, holderId: id }),
      };
    });
  }

  /** One holder's balance, even when it's zero. */
  private async holding(client: PoolClient, kind: HolderKind, id: string | null): Promise<Holding> {
    if (kind !== 'yard' && !id) throw new BadRequestException('Say which customer, farmer or vehicle');
    const name = await this.repo.holderName(client, kind, kind === 'yard' ? null : id);
    if (!name) throw new NotFoundException(`${kind[0].toUpperCase()}${kind.slice(1)} not found`);
    const [found] = await this.holdings(client, kind, kind === 'yard' ? null : id);
    if (found) return found;
    const limits = await this.repo.limits(client);
    return {
      holderKind: kind,
      holderId: kind === 'yard' ? null : id,
      holderName: name,
      byType: [],
      total: 0,
      value: '0.00',
      oldestSince: null,
      daysHeld: null,
      limit: limits.get(`${kind}:${id}`) ?? null,
      lastMovementAt: null,
    };
  }

  private async holdings(client: PoolClient, kind: HolderKind | null, id: string | null): Promise<Holding[]> {
    const books = await this.repo.books(client);
    const rows = await this.repo.balances(client, kind, id);
    const limits = await this.repo.limits(client);
    const partyKind = kind === 'customer' || kind === 'farmer' ? kind : null;
    const events = kind === null || partyKind ? await this.repo.partyEvents(client, books.timezone, partyKind, id) : [];

    const byHolder = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.holder_kind}:${r.holder_id ?? ''}`;
      byHolder.set(key, [...(byHolder.get(key) ?? []), r]);
    }
    const out: Holding[] = [];
    for (const [key, list] of byHolder) {
      const first = list[0];
      const holderKind = first.holder_kind as HolderKind;
      const holderId = first.holder_id as string | null;
      let oldestSince: string | null = null;
      if (holderKind === 'customer' || holderKind === 'farmer') {
        const mine = events.filter((e) => e.holder_kind === holderKind && e.holder_id === holderId);
        oldestSince = earliest(
          list.map((t) => oldestOutstanding(mine.filter((e) => e.crate_type_id === t.crate_type_id).map((e) => ({ on: e.on as string, delta: e.delta as number }))).since),
        );
      }
      const lastMovementAt = list.map((t) => t.last_movement_at as Date | null).reduce<Date | null>((a, b) => (!a || (b && b > a) ? b : a), null);
      out.push({
        holderKind,
        holderId,
        holderName: (first.holder_name as string | null) ?? 'Yard',
        byType: list.map((t) => ({ crateTypeId: t.crate_type_id as string, code: t.code as string, balance: t.balance as number })),
        total: list.reduce((s, t) => s + (t.balance as number), 0),
        value: sumMoney(list.map((t) => multiplyToMoney(String(t.balance), t.replacement_cost as string))),
        oldestSince,
        daysHeld: oldestSince ? daysBetween(oldestSince, books.today) : null,
        limit: limits.get(key) ?? null,
        lastMovementAt,
      });
    }
    return out.sort((a, b) => (b.daysHeld ?? -1) - (a.daysHeld ?? -1) || b.total - a.total || a.holderName.localeCompare(b.holderName));
  }

  // ---- Overview and alerts ----

  overview(tenantId: string): Promise<CrateOverview> {
    return this.db.withTenant(tenantId, async (client) => {
      const types = await this.repo.types(client);
      const holdings = await this.holdings(client, null, null);
      const lost = await this.repo.lostByType(client);
      const sumFor = (typeId: string, kind: HolderKind) =>
        holdings.filter((h) => h.holderKind === kind).reduce((s, h) => s + (h.byType.find((t) => t.crateTypeId === typeId)?.balance ?? 0), 0);
      return {
        types: types.map((t) => {
          const counts = { yard: sumFor(t.id, 'yard'), customers: sumFor(t.id, 'customer'), farmers: sumFor(t.id, 'farmer'), vehicles: sumFor(t.id, 'vehicle') };
          return { ...t, ...counts, lost: lost.get(t.id) ?? 0, owned: counts.yard + counts.customers + counts.farmers + counts.vehicles };
        }),
        alerts: await this.alertsFor(client, holdings, types),
      };
    });
  }

  alerts(tenantId: string): Promise<CrateAlert[]> {
    return this.db.withTenant(tenantId, async (client) => this.alertsFor(client, await this.holdings(client, null, null), await this.repo.types(client)));
  }

  private async alertsFor(client: PoolClient, holdings: Holding[], types: CrateType[]): Promise<CrateAlert[]> {
    const settings = await this.repo.settings(client);
    const onTrip = await this.repo.vehiclesOnTrip(client);
    const alerts: CrateAlert[] = [];
    for (const h of holdings) {
      if (h.holderKind === 'customer' || h.holderKind === 'farmer') {
        const allowance = h.holderKind === 'customer' ? settings.customerOverdueDays : settings.farmerOverdueDays;
        const severity = overdueSeverity(h.daysHeld, allowance);
        if (severity) {
          alerts.push({
            kind: 'overdue',
            severity,
            holderKind: h.holderKind,
            holderId: h.holderId,
            holderName: h.holderName,
            crates: h.total,
            message: `${h.total} crate${h.total === 1 ? '' : 's'}, the oldest out ${h.daysHeld} days (allowed ${allowance})`,
          });
        }
        if (h.limit !== null && h.total > h.limit) {
          alerts.push({
            kind: 'over_limit',
            severity: 'bad',
            holderKind: h.holderKind,
            holderId: h.holderId,
            holderName: h.holderName,
            crates: h.total,
            message: `Holds ${h.total} crates, over the limit of ${h.limit}`,
          });
        }
      }
      if (h.holderKind === 'vehicle' && h.total > 0 && h.holderId && !onTrip.has(h.holderId)) {
        alerts.push({
          kind: 'vehicle_idle',
          severity: 'attention',
          holderKind: 'vehicle',
          holderId: h.holderId,
          holderName: h.holderName,
          crates: h.total,
          message: `${h.total} crate${h.total === 1 ? '' : 's'} still on the vehicle with no trip on the road — unload them or record where they went`,
        });
      }
    }
    const yard = holdings.find((h) => h.holderKind === 'yard');
    for (const t of types.filter((x) => x.isActive && x.reorderLevel > 0)) {
      const inYard = yard?.byType.find((b) => b.crateTypeId === t.id)?.balance ?? 0;
      if (inYard < t.reorderLevel) {
        alerts.push({
          kind: 'yard_low',
          severity: 'attention',
          holderKind: 'yard',
          holderId: null,
          holderName: 'Yard',
          crates: inYard,
          message: `${t.code}: ${inYard} in the yard, below the reorder level of ${t.reorderLevel}`,
        });
      }
    }
    const rank = { bad: 0, attention: 1 };
    return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.crates - a.crates);
  }

  // ---- Movements ----

  listMovements(tenantId: string, q: { from?: string; to?: string; holderKind?: string; holderId?: string }): Promise<MovementRecord[]> {
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('from must be on or before to');
    if (q.from && q.to && daysBetween(q.from, q.to) > MAX_RANGE_DAYS) throw new BadRequestException(`A range covers at most ${MAX_RANGE_DAYS} days`);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      return this.repo.movements(client, {
        timezone: books.timezone,
        from: q.from ?? null,
        to: q.to ?? null,
        holderKind: q.holderKind ?? null,
        holderId: q.holderId ?? null,
        tripId: null,
        batchId: null,
        limit: 1000,
      });
    });
  }

  /** From and to for a recorded movement, from its kind and the party or vehicle it names. */
  private sides(dto: RecordMovementDto, vehicleId: string | null): { from: Side; to: Side } {
    const party = (): Side => {
      if (!dto.partyKind || !dto.partyId) throw new BadRequestException('Say which customer or farmer');
      return { kind: dto.partyKind, id: dto.partyId };
    };
    const vehicle = (): Side => {
      if (!vehicleId) throw new BadRequestException('Say which vehicle');
      return { kind: 'vehicle', id: vehicleId };
    };
    const yard: Side = { kind: 'yard', id: null };
    switch (dto.kind) {
      case 'purchased':
        return { from: { kind: 'outside', id: null }, to: yard };
      case 'opening':
        return { from: { kind: 'outside', id: null }, to: dto.partyId ? party() : vehicleId ? vehicle() : yard };
      case 'issued':
        return { from: yard, to: party() };
      case 'returned':
        return { from: party(), to: yard };
      case 'loaded':
        return { from: yard, to: vehicle() };
      case 'unloaded':
        return { from: vehicle(), to: yard };
      case 'delivered':
        return { from: vehicle(), to: party() };
      case 'collected':
        return { from: party(), to: vehicle() };
    }
  }

  /**
   * Records crates moving: bought, counted in, issued to or returned by a
   * customer or farmer, loaded on or unloaded from a vehicle, or dropped
   * and collected on the road. Several crate types at once share a batch.
   * A purchase with a cost posts Dr Crates and packaging / Cr bank or cash
   * (crates are expensed when bought).
   */
  async recordMovement(tenantId: string, userId: string, dto: RecordMovementDto): Promise<MovementRecord[]> {
    if (dto.kind !== 'purchased' && (dto.cost !== undefined || dto.paidFrom)) throw new BadRequestException('Only a purchase carries a cost');
    if (dto.cost !== undefined && !dto.paidFrom) throw new BadRequestException('Say how the crates were paid for — bank or cash');
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const occurredAt = await this.when(client, books, dto.occurredOn);
      let vehicleId = dto.vehicleId ?? null;
      if (dto.tripId) {
        const trip = await this.repo.trip(client, dto.tripId);
        if (!trip) throw new NotFoundException('Trip not found');
        if (vehicleId && vehicleId !== trip.vehicle_id) throw new BadRequestException('That trip runs on another vehicle');
        if (['loaded', 'unloaded', 'delivered', 'collected'].includes(dto.kind)) vehicleId = trip.vehicle_id as string;
      }
      const { from, to } = this.sides(dto, vehicleId);
      await this.repo.lock(client);
      const batchId = randomUUID();
      const ids = await this.move(client, tenantId, userId, {
        batchId,
        kind: dto.kind,
        from,
        to,
        lines: dto.lines,
        occurredAt,
        tripId: dto.tripId ?? null,
        tripStopId: null,
        reference: clean(dto.reference),
        notes: clean(dto.notes),
      });
      if (dto.cost !== undefined) {
        const cost = moneyFromNumber(dto.cost);
        const count = dto.lines.reduce((s, l) => s + l.quantity, 0);
        await this.ledger.postSystemWithClient(client, {
          tenantId,
          entryType: 'crates_purchased',
          sourceType: 'crate_movement',
          sourceId: batchId,
          occurredAt,
          memo: `${count} crates bought${dto.reference ? ` (${dto.reference.trim()})` : ''}`,
          createdBy: userId,
          lines: [
            { account: 'crate_purchases', debit: cost },
            { account: dto.paidFrom!, credit: cost },
          ],
        });
      }
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'crate_movement', entityId: batchId, after: { ...dto, from, to, movementIds: ids } });
      return this.repo.movements(client, { timezone: books.timezone, from: null, to: null, holderKind: null, holderId: null, tripId: null, batchId, limit: 50 });
    });
  }

  /**
   * Inserts one movement per line and refuses any that would take the
   * holder they leave below zero. The caller holds the tenant's crate lock.
   */
  private async move(
    client: PoolClient,
    tenantId: string,
    userId: string,
    m: {
      batchId: string;
      kind: MovementKind;
      from: Side;
      to: Side;
      lines: { crateTypeId: string; quantity: number }[];
      occurredAt: Date;
      tripId: string | null;
      tripStopId: string | null;
      reference: string | null;
      notes: string | null;
      reversesMovementId?: string;
    },
  ): Promise<string[]> {
    const seen = new Set<string>();
    for (const l of m.lines) {
      if (seen.has(l.crateTypeId)) throw new BadRequestException('Each crate type once per entry');
      seen.add(l.crateTypeId);
    }
    for (const side of [m.from, m.to]) {
      if (['customer', 'farmer', 'vehicle'].includes(side.kind) && !(await this.repo.holderName(client, side.kind as HolderKind, side.id))) {
        throw new NotFoundException(`${side.kind[0].toUpperCase()}${side.kind.slice(1)} not found`);
      }
    }
    const ids: string[] = [];
    for (const l of m.lines) {
      const type = await this.repo.findType(client, l.crateTypeId);
      if (!type) throw new NotFoundException('Crate type not found');
      if (!type.isActive && ['purchased', 'opening', 'issued', 'loaded'].includes(m.kind)) throw new ConflictException(`${type.code} is retired — it can come back, but not go out`);
      ids.push(
        await this.repo.insertMovement(client, {
          tenantId,
          batchId: m.batchId,
          crateTypeId: l.crateTypeId,
          quantity: l.quantity,
          kind: m.kind,
          fromKind: m.from.kind,
          fromId: m.from.id,
          toKind: m.to.kind,
          toId: m.to.id,
          occurredAt: m.occurredAt,
          tripId: m.tripId,
          tripStopId: m.tripStopId,
          reversesMovementId: m.reversesMovementId ?? null,
          reference: m.reference,
          notes: m.notes,
          userId,
        }),
      );
      if (m.from.kind !== 'outside' && m.from.kind !== 'lost') {
        const left = await this.repo.balanceOf(client, m.from.kind, m.from.id, l.crateTypeId);
        if (left < 0) {
          const had = left + l.quantity;
          const who = m.from.kind === 'yard' ? 'The yard' : (await this.repo.holderName(client, m.from.kind as HolderKind, m.from.id)) ?? HOLDER_LABEL[m.from.kind as HolderKind];
          throw new ConflictException(
            `${who} holds only ${had} ${type.code} crate${had === 1 ? '' : 's'}, not ${l.quantity}` +
              (m.from.kind === 'customer' || m.from.kind === 'farmer' ? ' — if they had crates before these records began, record an opening balance first' : ''),
          );
        }
      }
    }
    return ids;
  }

  private async when(client: PoolClient, books: Books, date: string | undefined): Promise<Date> {
    if (!date) return new Date();
    assertRealDate(date, 'occurredOn');
    if (date > books.today) throw new BadRequestException("Crates can't move on a future date");
    return this.repo.instant(client, books.timezone, books.today, date);
  }

  /**
   * Undoes a movement recorded by mistake with its mirror (DE.4) — never
   * an edit. Refused for a correction, for one already reversed, for a
   * purchase whose cost is on the books, and for a loss that was charged
   * (the invoice or deduction stands; correct it in Finance).
   */
  reverseMovement(tenantId: string, userId: string, id: string, reason: string): Promise<MovementRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      await this.repo.lock(client);
      const m = await this.repo.findMovement(client, id);
      if (!m) throw new NotFoundException('Movement not found');
      if (m.kind === 'correction') throw new ConflictException('A correction is itself final — record the movement again instead');
      if (m.reversedBy) throw new ConflictException('Already reversed');
      if (m.kind === 'lost') {
        const loss = await this.repo.lossForMovement(client, id);
        if (loss && loss.recovery !== 'absorbed') throw new ConflictException('These crates were charged for — the charge stands; if they turn up, record them as returned and credit the customer or farmer in Finance');
      }
      if (m.kind === 'purchased') {
        const costed = await client.query("SELECT 1 FROM money.ledger_entry WHERE entry_type = 'crates_purchased' AND source_id = $1", [m.batchId]);
        if (costed.rowCount) throw new ConflictException("This purchase's cost is on the books — correct the cost with a journal, and write surplus crates off as lost");
      }
      const [newId] = await this.move(client, tenantId, userId, {
        batchId: randomUUID(),
        kind: 'correction',
        from: { kind: m.to.kind, id: m.to.id },
        to: { kind: m.from.kind, id: m.from.id },
        lines: [{ crateTypeId: m.crateTypeId, quantity: m.quantity }],
        occurredAt: new Date(),
        tripId: m.tripId,
        tripStopId: m.tripStopId,
        reference: null,
        notes: reason.trim(),
        reversesMovementId: id,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'crate_movement', entityId: newId, after: { reverses: id, reason: reason.trim() } });
      return (await this.repo.findMovement(client, newId))!;
    });
  }

  // ---- Losses ----

  listLosses(tenantId: string, from?: string, to?: string): Promise<LossRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      return this.repo.losses(client, { timezone: books.timezone, from: from ?? null, to: to ?? null, holderKind: null, holderId: null });
    });
  }

  /**
   * Crates written off as lost from whoever held them. 'absorbed' costs
   * nothing more (crates were expensed when bought). 'charge' — for a
   * customer or farmer only, through its own route (crates:charge) — bills
   * the crates at their replacement cost (or the price given): a
   * crate-charge invoice to a customer, or a deduction from what a farmer
   * is owed.
   */
  async recordLoss(tenantId: string, userId: string, dto: RecordLossDto, route: 'absorbed' | 'charge'): Promise<LossRecord> {
    const charge = dto.recovery === 'charge';
    if (charge !== (route === 'charge')) {
      throw new BadRequestException(charge ? 'Charging for lost crates goes through /crates/losses/charge' : 'A loss written off without a charge goes through /crates/losses');
    }
    if (charge && dto.holderKind !== 'customer' && dto.holderKind !== 'farmer') throw new BadRequestException('Only a customer or farmer can be charged for lost crates');
    if (!charge && dto.unitCharge !== undefined) throw new BadRequestException('Only a charged loss has a price');
    const holderId = dto.holderKind === 'yard' ? null : dto.holderId ?? null;
    if (dto.holderKind !== 'yard' && !holderId) throw new BadRequestException('Say which customer, farmer or vehicle');

    const result = await this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const occurredAt = await this.when(client, books, dto.occurredOn);
      if (dto.tripId && !(await this.repo.trip(client, dto.tripId))) throw new NotFoundException('Trip not found');
      await this.repo.lock(client);
      const type = await this.repo.findType(client, dto.crateTypeId);
      if (!type) throw new NotFoundException('Crate type not found');
      const [movementId] = await this.move(client, tenantId, userId, {
        batchId: randomUUID(),
        kind: 'lost',
        from: { kind: dto.holderKind, id: holderId },
        to: { kind: 'lost', id: null },
        lines: [{ crateTypeId: dto.crateTypeId, quantity: dto.quantity }],
        occurredAt,
        tripId: dto.tripId ?? null,
        tripStopId: null,
        reference: null,
        notes: dto.reason.trim(),
      });

      let recovery: 'absorbed' | 'invoiced' | 'deducted' = 'absorbed';
      let unitCharge = '0.00';
      let amount = '0.00';
      let taxAmount = '0.00';
      let invoiceId: string | null = null;
      let entryId: string | null = null;
      let lotsPaid: string[] = [];
      if (charge) {
        unitCharge = dto.unitCharge !== undefined ? moneyFromNumber(dto.unitCharge) : type.replacementCost;
        const description = `${dto.quantity} lost ${type.name} crate${dto.quantity === 1 ? '' : 's'} (${type.code}) at ${unitCharge}`;
        if (dto.holderKind === 'customer') {
          const invoice = await this.receivables.issueCrateChargeWithClient(client, tenantId, userId, {
            customerId: holderId!,
            movementId,
            description,
            quantity: String(dto.quantity),
            unitPrice: unitCharge,
            hsnCode: type.hsnCode,
            occurredAt,
          });
          recovery = 'invoiced';
          amount = invoice.amount;
          taxAmount = invoice.taxAmount;
          invoiceId = invoice.invoiceId;
          entryId = invoice.entryId;
        } else {
          amount = multiplyToMoney(String(dto.quantity), unitCharge);
          const deduction = await this.payables.deductWithClient(client, tenantId, userId, {
            farmerId: holderId!,
            amount,
            sourceType: 'crate_loss',
            sourceId: movementId,
            memo: `Deducted for ${description}`,
            occurredAt,
          });
          recovery = 'deducted';
          entryId = deduction.entryId;
          lotsPaid = deduction.fullyPaidLots;
          const lossId = await this.repo.insertLoss(client, { tenantId, movementId, recovery, unitCharge, amount, taxAmount, invoiceId, entryId, reason: dto.reason.trim(), userId });
          await this.repo.insertDeductions(client, tenantId, lossId, deduction.deductions);
          await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'crate_loss', entityId: lossId, after: { ...dto, recovery, unitCharge, amount, deductions: deduction.deductions } });
          return { lossId, lotsPaid, timezone: books.timezone };
        }
      }
      const lossId = await this.repo.insertLoss(client, { tenantId, movementId, recovery, unitCharge, amount, taxAmount, invoiceId, entryId, reason: dto.reason.trim(), userId });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'crate_loss', entityId: lossId, after: { ...dto, recovery, unitCharge, amount, taxAmount, invoiceId } });
      return { lossId, lotsPaid, timezone: books.timezone };
    });

    // After COMMIT, like a farmer payment: lots the deduction left fully settled.
    await this.payables.announceLotsPaid(tenantId, userId, result.lotsPaid);
    const losses = await this.db.withTenant(tenantId, (client) =>
      this.repo.losses(client, { timezone: result.timezone, from: null, to: null, holderKind: dto.holderKind, holderId }),
    );
    return losses.find((l) => l.id === result.lossId)!;
  }

  // ---- Trips ----

  getTrip(tenantId: string, tripId: string): Promise<TripCrates> {
    return this.db.withTenant(tenantId, (client) => this.tripCrates(client, tripId));
  }

  private async tripCrates(client: PoolClient, tripId: string): Promise<TripCrates> {
    const trip = await this.repo.trip(client, tripId);
    if (!trip) throw new NotFoundException('Trip not found');
    const books = await this.repo.books(client);
    const movements = await this.repo.movements(client, { timezone: books.timezone, from: null, to: null, holderKind: null, holderId: null, tripId, batchId: null, limit: 1000 });
    // What stands: a reversed movement and its correction cancel out.
    const live = movements.filter((m) => !m.reversedBy && m.kind !== 'correction');
    const sum = (pred: (m: MovementRecord) => boolean) => live.filter(pred).reduce((s, m) => s + m.quantity, 0);
    const vehicle = await this.repo.balances(client, 'vehicle', trip.vehicle_id as string);
    const stops = await this.repo.tripStops(client, tripId);
    return {
      tripId,
      vehicleId: trip.vehicle_id as string,
      registrationNumber: trip.registration_number as string,
      status: trip.status as string,
      onVehicle: vehicle.map((b) => ({ crateTypeId: b.crate_type_id as string, code: b.code as string, balance: b.balance as number })),
      loaded: sum((m) => m.kind === 'loaded'),
      unloaded: sum((m) => m.kind === 'unloaded'),
      stops: stops.map((s) => ({
        stopId: s.id as string,
        sequenceNumber: s.sequence_number as number,
        stopType: s.stop_type as 'pickup' | 'delivery',
        party: { kind: s.party_kind as 'customer' | 'farmer', id: s.party_id as string, name: s.party_name as string },
        dropped: sum((m) => m.tripStopId === s.id && m.kind === 'delivered'),
        collected: sum((m) => m.tripStopId === s.id && m.kind === 'collected'),
      })),
      movements,
    };
  }

  /**
   * The crates at one stop: left with the customer or farmer (vehicle →
   * party) and taken back from them (party → vehicle). Collections are
   * recorded first, so crates collected at a stop can be dropped there.
   */
  recordStopCounts(tenantId: string, userId: string, tripId: string, stopId: string, dto: StopCountsDto): Promise<TripCrates> {
    return this.db.withTenant(tenantId, async (client) => {
      const trip = await this.repo.trip(client, tripId);
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status === 'cancelled') throw new ConflictException('This trip was cancelled');
      const stop = (await this.repo.tripStops(client, tripId)).find((s) => s.id === stopId);
      if (!stop) throw new NotFoundException('Stop not found on this trip');
      const collected = dto.lines.filter((l) => l.collected > 0).map((l) => ({ crateTypeId: l.crateTypeId, quantity: l.collected }));
      const dropped = dto.lines.filter((l) => l.dropped > 0).map((l) => ({ crateTypeId: l.crateTypeId, quantity: l.dropped }));
      if (!collected.length && !dropped.length) throw new BadRequestException('No crates to record');
      await this.repo.lock(client);
      const party: Side = { kind: stop.party_kind as string, id: stop.party_id as string };
      const vehicle: Side = { kind: 'vehicle', id: trip.vehicle_id as string };
      const base = { occurredAt: new Date(), tripId, tripStopId: stopId, reference: null, notes: clean(dto.notes) };
      const batchId = randomUUID();
      if (collected.length) await this.move(client, tenantId, userId, { ...base, batchId, kind: 'collected', from: party, to: vehicle, lines: collected });
      if (dropped.length) await this.move(client, tenantId, userId, { ...base, batchId, kind: 'delivered', from: vehicle, to: party, lines: dropped });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'crate_movement', entityId: batchId, after: { tripId, stopId, collected, dropped } });
      return this.tripCrates(client, tripId);
    });
  }
}
