import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { LedgerLineInput } from '../finance/repositories/ledger.repository';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { TaxRulesRepository } from '../tax-rules/repositories/tax-rules.repository';
import { DeducteeType } from '../tax-rules/entities/tax-rules.entity';
import { assertRealDate } from '../../common/period';
import { deducteeTypeFromPan } from '../../common/india';
import {
  compareMoney,
  fromCents,
  isPositiveMoney,
  moneyFromNumber,
  multiplyToMoney,
  percentOfMoney,
  subtractMoney,
  sumMoney,
  toCents,
} from '../../common/money';
import { FleetRepository } from './repositories/fleet.repository';
import {
  addMonths,
  AssetTerms,
  depreciationSchedule,
  disposalResult,
  emi as emiFor,
  firstOfMonth,
  fuelEconomy,
  monthlyInterest,
  remainingSchedule,
  splitPayment,
} from './fleet-math';
import {
  AssetView,
  DocState,
  DocType,
  EconomicsReport,
  EconomicsRow,
  FleetSettings,
  HireBill,
  HireContract,
  HireSuggestion,
  LoanView,
  VehicleDetail,
  VehicleOverview,
} from './entities/fleet.entity';
import {
  CapitalizeVehicleDto,
  CreateLoanDto,
  DisposeVehicleDto,
  FleetSettingsDto,
  HireContractDto,
  PayEmiDto,
  PayHireBillDto,
  RecordDocumentDto,
  RecordFuelDto,
  RecordHireBillDto,
  RecordMaintenanceDto,
  VehicleProfileDto,
} from './dto/fleet.dto';

type Row = Record<string, unknown>;
type Books = { today: string; timezone: string; currency: string };

const MAX_RANGE_DAYS = 366;
const DOC_LABEL: Record<DocType, string> = {
  registration: 'Registration (RC)',
  insurance: 'Insurance',
  puc: 'PUC certificate',
  fitness: 'Fitness certificate',
  permit: 'Permit',
  road_tax: 'Road tax',
  other: 'Other document',
};

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function lastOfMonth(month: string): string {
  return addDays(addMonths(month, 1), -1);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Where a document stands today: past its date, inside the reminder window, fine, or never expiring. */
export function documentState(validUntil: string | null, today: string, reminderDays: number): DocState {
  if (!validUntil) return 'no_expiry';
  if (validUntil < today) return 'expired';
  if (validUntil <= addDays(today, reminderDays)) return 'expiring';
  return 'valid';
}

/**
 * Vehicle economics (Domain Model: Vehicles owns the vehicle, its
 * maintenance and whether it's fit to be assigned). What a vehicle costs to
 * run — fuel, maintenance, documents, depreciation, loan interest, hire —
 * each posted to the ledger as it happens through Finance's LedgerService,
 * in the same transaction as the record (DE.1, DE.3). The asset follows
 * Accounting Engine VEH.1–5: capitalised at cost, depreciated monthly on a
 * tenant-chosen method, disposed of as an explicit event with its gain or
 * loss against net book value. Nothing here is edited once posted:
 * corrections are new records (DE.4, Constitution III.3).
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FleetRepository,
    private readonly ledger: LedgerService,
    private readonly taxRules: TaxRulesService,
    private readonly taxRulesRepo: TaxRulesRepository,
    private readonly audit: AuditService,
  ) {}

  private notFuture(date: string, field: string, books: Books, what: string): void {
    assertRealDate(date, field);
    if (date > books.today) throw new BadRequestException(`${what} can't be dated in the future`);
  }

  private async vehicle(client: PoolClient, id: string) {
    const v = await this.repo.vehicleExists(client, id);
    if (!v) throw new NotFoundException('Vehicle not found');
    return v;
  }

  private async liveVehicle(client: PoolClient, id: string) {
    const v = await this.vehicle(client, id);
    if (v.status === 'disposed') throw new ConflictException(`${v.registration_number} has been disposed of`);
    return v;
  }

  // ---- Settings ----

  getSettings(tenantId: string): Promise<FleetSettings> {
    return this.db.withTenant(tenantId, (client) => this.repo.settings(client));
  }

  saveSettings(tenantId: string, userId: string, dto: FleetSettingsDto): Promise<FleetSettings> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.repo.settings(client);
      const ok = await this.repo.saveSettings(client, tenantId, userId, dto.version, {
        documentReminderDays: dto.documentReminderDays,
        blockTripsOnExpired: dto.blockTripsOnExpired,
      });
      if (!ok) throw new ConflictException('Fleet settings were changed by someone else — reload and try again');
      const after = await this.repo.settings(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.version === 0 ? 'create' : 'update',
        entityType: 'fleet_settings',
        entityId: tenantId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Overview ----

  listVehicles(tenantId: string): Promise<VehicleOverview[]> {
    return this.db.withTenant(tenantId, (client) => this.overviews(client, null));
  }

  getVehicle(tenantId: string, vehicleId: string): Promise<VehicleDetail> {
    return this.db.withTenant(tenantId, (client) => this.detail(client, vehicleId));
  }

  private async overviews(client: PoolClient, vehicleId: string | null): Promise<VehicleOverview[]> {
    const books = await this.repo.books(client);
    const settings = await this.repo.settings(client);
    const [vehicles, documents, maintenance, loans, contracts, unpaid] = await Promise.all([
      this.repo.vehicles(client, vehicleId),
      this.repo.documents(client, vehicleId),
      this.repo.maintenance(client, vehicleId),
      this.repo.loans(client, vehicleId),
      this.repo.contracts(client, vehicleId),
      this.repo.bills(client, vehicleId, 'unpaid'),
    ]);
    const out: VehicleOverview[] = [];
    for (const v of vehicles) {
      const id = v.vehicle_id as string;
      const current = documents.filter((d) => d.vehicle_id === id && !d.superseded && d.doc_type !== 'other');
      const docs = current.map((d) => ({
        docType: d.doc_type as DocType,
        validUntil: d.valid_until as string | null,
        state: documentState(d.valid_until as string | null, books.today, settings.documentReminderDays),
      }));
      const lastOdometerKm = (v.last_odometer as number | null) ?? null;
      const due = maintenance.find((m) => m.vehicleId === id && (m.nextDueDate || m.nextDueKm));
      const maintenanceDue = due
        ? {
            date: due.nextDueDate,
            km: due.nextDueKm,
            overdue: (due.nextDueDate !== null && due.nextDueDate < books.today) || (due.nextDueKm !== null && lastOdometerKm !== null && lastOdometerKm >= due.nextDueKm),
          }
        : null;

      const issues: string[] = [];
      if (v.status !== 'active') issues.push(v.status === 'disposed' ? 'Disposed of' : 'In maintenance');
      for (const d of docs) {
        if (d.state === 'expired') issues.push(`${DOC_LABEL[d.docType]} expired on ${d.validUntil}`);
      }
      for (const d of docs) {
        if (d.state === 'expiring') issues.push(`${DOC_LABEL[d.docType]} expires on ${d.validUntil}`);
      }
      if (maintenanceDue?.overdue) issues.push(`Maintenance overdue${maintenanceDue.date ? ` (due ${maintenanceDue.date})` : ` (due at ${maintenanceDue.km!.toLocaleString('en-IN')} km)`}`);

      let netBookValue: string | null = null;
      if (v.ownership === 'owned') {
        const asset = await this.repo.asset(client, id);
        if (asset) netBookValue = subtractMoney(asset.cost as string, asset.accumulated as string);
      }
      const vehicleLoans = loans.filter((l) => l.vehicle_id === id && l.status === 'active');
      const contract = contracts.find((c) => c.vehicleId === id && c.effectiveFrom <= books.today && (!c.effectiveTo || c.effectiveTo >= books.today)) ?? null;

      out.push({
        vehicleId: id,
        registrationNumber: v.registration_number as string,
        status: v.status as VehicleOverview['status'],
        fuelType: v.fuel_type as string,
        capacityKg: v.capacity_kg as string,
        ownership: v.ownership as VehicleOverview['ownership'],
        makeModel: v.make_model as string | null,
        manufactureYear: v.manufacture_year as number | null,
        profileVersion: v.profile_version as number,
        fitForTrips: v.status === 'active' && !docs.some((d) => d.state === 'expired'),
        issues,
        documents: docs,
        maintenanceDue,
        lastOdometerKm,
        netBookValue: v.status === 'disposed' ? null : netBookValue,
        loanOutstanding: sumMoney(vehicleLoans.map((l) => subtractMoney(l.principal as string, l.principal_repaid as string))),
        hireContract: contract,
        unpaidHire: sumMoney(unpaid.filter((b) => b.vehicleId === id).map((b) => b.amount)),
      });
    }
    return out;
  }

  private async detail(client: PoolClient, vehicleId: string): Promise<VehicleDetail> {
    const [overview] = await this.overviews(client, vehicleId);
    if (!overview) throw new NotFoundException('Vehicle not found');
    const books = await this.repo.books(client);
    const settings = await this.repo.settings(client);
    const documents = await this.repo.documents(client, vehicleId);
    const loans = await this.repo.loans(client, vehicleId);
    const loanViews: LoanView[] = [];
    for (const l of loans) loanViews.push(await this.loanView(client, l));
    return {
      ...overview,
      allDocuments: documents.map((d) =>
        FleetRepository.toDocument(d, documentState(d.valid_until as string | null, books.today, settings.documentReminderDays)),
      ),
      fuel: await this.repo.fuel(client, vehicleId, null, null),
      maintenance: await this.repo.maintenance(client, vehicleId),
      asset: await this.assetView(client, vehicleId),
      loans: loanViews,
      hireContracts: await this.repo.contracts(client, vehicleId),
      hireBills: await this.repo.bills(client, vehicleId, null),
    };
  }

  saveProfile(tenantId: string, userId: string, vehicleId: string, dto: VehicleProfileDto): Promise<VehicleDetail> {
    return this.db.withTenant(tenantId, async (client) => {
      const v = await this.vehicle(client, vehicleId);
      if (dto.ownership !== v.ownership) {
        if (dto.ownership === 'hired' && (await this.repo.asset(client, vehicleId))) {
          throw new ConflictException(`${v.registration_number} is on the books as an owned asset — it can't be marked hired`);
        }
        if (dto.ownership === 'owned' && (await this.repo.contracts(client, vehicleId)).length > 0) {
          throw new ConflictException(`${v.registration_number} has hire contracts — it can't be marked owned`);
        }
      }
      const before = await this.detail(client, vehicleId);
      const ok = await this.repo.saveProfile(client, tenantId, vehicleId, userId, dto.version, {
        ownership: dto.ownership,
        makeModel: clean(dto.makeModel),
        manufactureYear: dto.manufactureYear ?? null,
      });
      if (!ok) throw new ConflictException("This vehicle's details were changed by someone else — reload and try again");
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: before.profileVersion === 0 ? 'create' : 'update',
        entityType: 'vehicle_profile',
        entityId: vehicleId,
        before: { ownership: before.ownership, makeModel: before.makeModel, manufactureYear: before.manufactureYear },
        after: { ownership: dto.ownership, makeModel: clean(dto.makeModel), manufactureYear: dto.manufactureYear ?? null },
      });
      return this.detail(client, vehicleId);
    });
  }

  /**
   * Called by Logistics before a vehicle is assigned to a trip or leaves on
   * one. A document type counts once one has been recorded for the vehicle;
   * the latest of it must still be in force. Advisory when the tenant has
   * turned blocking off.
   */
  async assertRoadworthyWithClient(client: PoolClient, vehicleId: string): Promise<void> {
    const v = await this.vehicle(client, vehicleId);
    if (v.status !== 'active') throw new ConflictException(`${v.registration_number} is not active (status: ${v.status})`);
    const settings = await this.repo.settings(client);
    if (!settings.blockTripsOnExpired) return;
    const books = await this.repo.books(client);
    const expired = (await this.repo.documents(client, vehicleId)).filter(
      (d) => !d.superseded && d.doc_type !== 'other' && d.valid_until !== null && (d.valid_until as string) < books.today,
    );
    if (expired.length) {
      const list = expired.map((d) => `${DOC_LABEL[d.doc_type as DocType]} (expired ${d.valid_until})`).join(', ');
      throw new ConflictException(`This vehicle isn't fit for trips: ${list}. Record the renewal under Vehicles.`);
    }
  }

  // ---- Fuel, maintenance, documents ----

  listFuel(tenantId: string, from: string, to: string, vehicleId?: string) {
    this.range(from, to);
    return this.db.withTenant(tenantId, (client) => this.repo.fuel(client, vehicleId ?? null, from, to));
  }

  /** Dr Vehicle fuel / Cr bank or cash. An odometer reading can't go backwards. */
  recordFuel(tenantId: string, userId: string, dto: RecordFuelDto): Promise<VehicleDetail> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.filledOn, 'filledOn', books, 'A fill');
      const v = await this.liveVehicle(client, dto.vehicleId);
      await this.odometerCheck(client, dto.vehicleId, dto.filledOn, dto.odometerKm);
      if (dto.tripId) {
        const tripVehicle = await this.repo.tripVehicle(client, dto.tripId);
        if (!tripVehicle) throw new NotFoundException('Trip not found');
        if (tripVehicle !== dto.vehicleId) throw new BadRequestException('That trip ran on another vehicle');
      }
      const amount = moneyFromNumber(dto.amount);
      const litres = dto.litres.toFixed(3);
      const id = randomUUID();
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_fuel_bought',
        sourceType: 'fuel_log',
        sourceId: id,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.filledOn),
        memo: `Fuel for ${v.registration_number}: ${litres} L${dto.station ? ` at ${dto.station.trim()}` : ''}`,
        createdBy: userId,
        lines: [
          { account: 'vehicle_fuel', debit: amount },
          { account: dto.paidFrom, credit: amount },
        ],
      });
      await this.repo.insertFuel(client, {
        id,
        tenantId,
        vehicleId: dto.vehicleId,
        filledOn: dto.filledOn,
        litres,
        amount,
        odometerKm: dto.odometerKm ?? null,
        station: clean(dto.station),
        paidFrom: dto.paidFrom,
        tripId: dto.tripId ?? null,
        entryId,
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'fuel_log', entityId: id, after: { ...dto, amount, litres, entryId } });
      return this.detail(client, dto.vehicleId);
    });
  }

  private async odometerCheck(client: PoolClient, vehicleId: string, date: string, km: number | undefined): Promise<void> {
    if (km === undefined) return;
    const last = await this.repo.lastOdometer(client, vehicleId, date);
    if (last && km < last.km) throw new BadRequestException(`The odometer read ${last.km} km on ${last.on} — it can't read less after that`);
  }

  /** Dr Repairs and maintenance / Cr bank or cash; nothing posted for work at no charge. */
  recordMaintenance(tenantId: string, userId: string, dto: RecordMaintenanceDto): Promise<VehicleDetail> {
    const amount = moneyFromNumber(dto.amount);
    const charged = isPositiveMoney(amount);
    if (charged && !dto.paidFrom) throw new BadRequestException('Say how it was paid for — bank or cash');
    if (dto.nextDueDate) assertRealDate(dto.nextDueDate, 'nextDueDate');
    if (dto.nextDueDate && dto.nextDueDate <= dto.serviceDate) throw new BadRequestException('The next service is due after this one');
    if (dto.nextDueKm !== undefined && dto.odometerKm !== undefined && dto.nextDueKm <= dto.odometerKm) {
      throw new BadRequestException('The next service is due at more km than the odometer reads now');
    }
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.serviceDate, 'serviceDate', books, 'Maintenance');
      const v = await this.liveVehicle(client, dto.vehicleId);
      await this.odometerCheck(client, dto.vehicleId, dto.serviceDate, dto.odometerKm);
      const id = randomUUID();
      const entryId = charged
        ? await this.ledger.postSystemWithClient(client, {
            tenantId,
            entryType: 'vehicle_maintained',
            sourceType: 'maintenance_record',
            sourceId: id,
            occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.serviceDate),
            memo: `${v.registration_number} ${dto.kind}: ${dto.description.trim()}${dto.vendor ? ` (${dto.vendor.trim()})` : ''}`,
            createdBy: userId,
            lines: [
              { account: 'repairs_maintenance', debit: amount },
              { account: dto.paidFrom!, credit: amount },
            ],
          })
        : null;
      await this.repo.insertMaintenance(client, {
        id,
        tenantId,
        vehicleId: dto.vehicleId,
        serviceDate: dto.serviceDate,
        kind: dto.kind,
        description: dto.description.trim(),
        vendor: clean(dto.vendor),
        odometerKm: dto.odometerKm ?? null,
        amount,
        paidFrom: charged ? dto.paidFrom! : null,
        nextDueDate: dto.nextDueDate ?? null,
        nextDueKm: dto.nextDueKm ?? null,
        entryId,
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'maintenance_record', entityId: id, after: { ...dto, amount, entryId } });
      return this.detail(client, dto.vehicleId);
    });
  }

  /**
   * A document or its renewal — the latest of a type is the one in force.
   * A premium or fee paid with it posts Dr Vehicle insurance, taxes and
   * permits / Cr bank or cash, expensed when paid.
   */
  recordDocument(tenantId: string, userId: string, dto: RecordDocumentDto): Promise<VehicleDetail> {
    const amount = moneyFromNumber(dto.amount ?? 0);
    const charged = isPositiveMoney(amount);
    if (charged && !dto.paidFrom) throw new BadRequestException('Say how it was paid for — bank or cash');
    if (dto.validFrom) assertRealDate(dto.validFrom, 'validFrom');
    if (dto.validUntil) assertRealDate(dto.validUntil, 'validUntil');
    if (!dto.validUntil && dto.docType !== 'registration' && dto.docType !== 'other') {
      throw new BadRequestException(`${DOC_LABEL[dto.docType as DocType]} needs the date it's valid until`);
    }
    if (dto.validFrom && dto.validUntil && dto.validUntil < dto.validFrom) throw new BadRequestException('It expires before it starts');
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const v = await this.liveVehicle(client, dto.vehicleId);
      const id = randomUUID();
      const label = DOC_LABEL[dto.docType as DocType];
      const entryId = charged
        ? await this.ledger.postSystemWithClient(client, {
            tenantId,
            entryType: 'vehicle_document_paid',
            sourceType: 'vehicle_document',
            sourceId: id,
            occurredAt: new Date(),
            memo: `${label} for ${v.registration_number}${dto.docNumber ? ` (${dto.docNumber.trim()})` : ''}${dto.validUntil ? `, to ${dto.validUntil}` : ''}`,
            createdBy: userId,
            lines: [
              { account: 'vehicle_insurance_taxes', debit: amount },
              { account: dto.paidFrom!, credit: amount },
            ],
          })
        : null;
      await this.repo.insertDocument(client, {
        id,
        tenantId,
        vehicleId: dto.vehicleId,
        docType: dto.docType,
        docNumber: clean(dto.docNumber),
        issuer: clean(dto.issuer),
        validFrom: dto.validFrom ?? null,
        validUntil: dto.validUntil ?? null,
        amount,
        paidFrom: charged ? dto.paidFrom! : null,
        notes: clean(dto.notes),
        entryId,
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'vehicle_document', entityId: id, after: { ...dto, amount, entryId, today: books.today } });
      return this.detail(client, dto.vehicleId);
    });
  }

  // ---- The asset (VEH.1–5) ----

  private terms(a: Row): AssetTerms {
    return {
      capitalizedOn: a.capitalized_on as string,
      cost: a.cost as string,
      salvageValue: a.salvage_value as string,
      method: a.method as AssetTerms['method'],
      usefulLifeMonths: a.useful_life_months as number | null,
      annualRate: a.annual_rate as string | null,
    };
  }

  private async assetView(client: PoolClient, vehicleId: string): Promise<AssetView | null> {
    const a = await this.repo.asset(client, vehicleId);
    if (!a) return null;
    const d = await this.repo.disposal(client, vehicleId);
    return {
      capitalizedOn: a.capitalized_on as string,
      cost: a.cost as string,
      salvageValue: a.salvage_value as string,
      method: a.method as AssetView['method'],
      usefulLifeMonths: a.useful_life_months as number | null,
      annualRate: a.annual_rate as string | null,
      fundedBy: a.funded_by as AssetView['fundedBy'],
      accumulated: a.accumulated as string,
      netBookValue: subtractMoney(a.cost as string, a.accumulated as string),
      depreciatedThrough: a.depreciated_through as string | null,
      entries: (await this.repo.depreciationEntries(client, vehicleId)).map((e) => ({
        month: e.month as string,
        amount: e.amount as string,
        accumulatedAfter: e.accumulated_after as string,
      })),
      disposal: d
        ? {
            disposedOn: d.disposed_on as string,
            method: d.method as 'sold' | 'scrapped' | 'written_off',
            proceeds: d.proceeds as string,
            netBookValue: d.net_book_value as string,
            gainLoss: d.gain_loss as string,
            buyer: d.buyer as string | null,
          }
        : null,
    };
  }

  /**
   * VEH.1: the vehicle enters the books at cost —
   *   Dr Vehicles (cost) / Cr Accumulated depreciation (any charged before
   *   these books began) / Cr bank, cash or owner's capital (the rest).
   */
  capitalize(tenantId: string, userId: string, vehicleId: string, dto: CapitalizeVehicleDto): Promise<VehicleDetail> {
    const cost = moneyFromNumber(dto.cost);
    const salvage = moneyFromNumber(dto.salvageValue);
    const opening = moneyFromNumber(dto.openingAccumulated ?? 0);
    if (compareMoney(salvage, cost) >= 0) throw new BadRequestException('The salvage value must be less than the cost');
    if (compareMoney(opening, subtractMoney(cost, salvage)) > 0) throw new BadRequestException('Opening depreciation is more than there is to depreciate');
    if (dto.method === 'straight_line' && !dto.usefulLifeMonths) throw new BadRequestException('Straight line needs the useful life in months');
    if (dto.method === 'written_down' && !dto.annualRate) throw new BadRequestException('Written-down value needs the yearly rate');
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.capitalizedOn, 'capitalizedOn', books, 'Capitalisation');
      const v = await this.liveVehicle(client, vehicleId);
      if (v.ownership === 'hired') throw new ConflictException(`${v.registration_number} is hired — only an owned vehicle is an asset`);
      if (await this.repo.asset(client, vehicleId)) throw new ConflictException(`${v.registration_number} is already on the books`);
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_capitalized',
        sourceType: 'vehicle_asset',
        sourceId: vehicleId,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.capitalizedOn),
        memo: `${v.registration_number} capitalised at ${cost}`,
        createdBy: userId,
        lines: [
          { account: 'fixed_assets_vehicles', debit: cost },
          { account: 'accumulated_depreciation', credit: opening },
          { account: dto.fundedBy, credit: subtractMoney(cost, opening) },
        ],
      });
      await this.repo.insertAsset(client, {
        vehicleId,
        tenantId,
        capitalizedOn: dto.capitalizedOn,
        cost,
        salvageValue: salvage,
        method: dto.method,
        usefulLifeMonths: dto.method === 'straight_line' ? dto.usefulLifeMonths! : null,
        annualRate: dto.method === 'written_down' ? dto.annualRate!.toFixed(2) : null,
        fundedBy: dto.fundedBy,
        openingAccumulated: opening,
        entryId,
        userId,
      });
      await this.repo.setAcquisition(client, vehicleId, cost, dto.capitalizedOn);
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'vehicle_asset', entityId: vehicleId, after: { ...dto, cost, salvage, opening, entryId } });
      return this.detail(client, vehicleId);
    });
  }

  listAssets(tenantId: string) {
    return this.db.withTenant(tenantId, async (client) => {
      const rows = await this.repo.assets(client);
      return rows.map((a) => ({
        vehicleId: a.vehicle_id as string,
        registrationNumber: a.registration_number as string,
        capitalizedOn: a.capitalized_on as string,
        cost: a.cost as string,
        method: a.method as string,
        accumulated: a.accumulated as string,
        netBookValue: a.disposed_on ? '0.00' : subtractMoney(a.cost as string, a.accumulated as string),
        depreciatedThrough: a.depreciated_through as string | null,
        disposedOn: a.disposed_on as string | null,
      }));
    });
  }

  /**
   * VEH.2: charges depreciation for every owned vehicle, month by month,
   * from where each left off through a month that's over — one ledger entry
   * per month, dated its last day (Dr Depreciation / Cr Accumulated
   * depreciation), so each month's P&L carries its own charge. A closed
   * month refuses it (the ledger's period lock).
   */
  runDepreciation(tenantId: string, userId: string, throughMonth: string): Promise<{ months: { month: string; total: string; vehicles: number }[] }> {
    const through = `${throughMonth}-01`;
    assertRealDate(through, 'throughMonth');
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      if (through >= firstOfMonth(books.today)) throw new BadRequestException(`${throughMonth} isn't over yet`);
      await this.repo.lockDepreciation(client);
      const assets = (await this.repo.assets(client)).filter((a) => !a.disposed_on);

      // Month → charges across vehicles.
      const byMonth = new Map<string, { vehicleId: string; registration: string; amount: string; accumulatedAfter: string }[]>();
      for (const a of assets) {
        const full = await this.repo.asset(client, a.vehicle_id as string);
        const terms = this.terms(full!);
        const start = full!.depreciated_through ? addMonths(full!.depreciated_through as string, 1) : firstOfMonth(terms.capitalizedOn);
        for (const m of depreciationSchedule(terms, start, through, full!.accumulated as string)) {
          const list = byMonth.get(m.month) ?? [];
          list.push({ vehicleId: a.vehicle_id as string, registration: a.registration_number as string, amount: m.amount, accumulatedAfter: m.accumulatedAfter });
          byMonth.set(m.month, list);
        }
      }
      if (byMonth.size === 0) throw new ConflictException(`Depreciation is already charged through ${throughMonth} for every vehicle`);

      const months: { month: string; total: string; vehicles: number }[] = [];
      for (const month of [...byMonth.keys()].sort()) {
        const charges = byMonth.get(month)!;
        const total = sumMoney(charges.map((c) => c.amount));
        const runId = randomUUID();
        const entryId = isPositiveMoney(total)
          ? await this.ledger.postSystemWithClient(client, {
              tenantId,
              entryType: 'vehicle_depreciated',
              sourceType: 'depreciation_run',
              sourceId: runId,
              occurredAt: await this.repo.instant(client, books.timezone, books.today, lastOfMonth(month)),
              memo: `Vehicle depreciation for ${month.slice(0, 7)}: ${charges.filter((c) => isPositiveMoney(c.amount)).map((c) => `${c.registration} ${c.amount}`).join(', ')}`,
              createdBy: userId,
              lines: [
                { account: 'depreciation_expense', debit: total },
                { account: 'accumulated_depreciation', credit: total },
              ],
            })
          : null;
        await this.repo.insertRun(client, { id: runId, tenantId, throughMonth: month, total, entryId, userId });
        for (const c of charges) await this.repo.insertDepreciation(client, tenantId, runId, c.vehicleId, month, c.amount, c.accumulatedAfter);
        months.push({ month: month.slice(0, 7), total, vehicles: charges.length });
      }
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'depreciation_run', entityId: tenantId, after: { throughMonth, months } });
      return { months };
    });
  }

  /**
   * VEH.3–5: disposal is its own event. Depreciation must be charged
   * through the month before; none is charged for the month of disposal.
   *   Dr bank/cash (proceeds), Dr Accumulated depreciation, Cr Vehicles (cost),
   *   and the difference to Gain or Loss on disposal.
   */
  dispose(tenantId: string, userId: string, vehicleId: string, dto: DisposeVehicleDto): Promise<VehicleDetail> {
    const proceeds = moneyFromNumber(dto.proceeds);
    const received = isPositiveMoney(proceeds);
    if (received && !dto.receivedInto) throw new BadRequestException('Say where the proceeds went — bank or cash');
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.disposedOn, 'disposedOn', books, 'A disposal');
      const v = await this.liveVehicle(client, vehicleId);
      await this.repo.lockDepreciation(client);
      const asset = await this.repo.asset(client, vehicleId);
      if (!asset) throw new ConflictException(`${v.registration_number} isn't on the books as an asset — capitalise it first, or mark it disposed under Vehicles`);
      if (dto.disposedOn < (asset.capitalized_on as string)) throw new BadRequestException(`It was capitalised on ${asset.capitalized_on}`);
      const month = firstOfMonth(dto.disposedOn);
      const through = asset.depreciated_through as string | null;
      const expected = through ? addMonths(through, 1) : firstOfMonth(asset.capitalized_on as string);
      if (month > expected) {
        throw new ConflictException(`Run depreciation through ${addMonths(month, -1).slice(0, 7)} before disposing of it`);
      }
      if (month < expected) {
        throw new ConflictException(`Depreciation is charged through ${through!.slice(0, 7)} — a disposal is dated after that`);
      }
      const accumulated = asset.accumulated as string;
      const { netBookValue, gainLoss } = disposalResult(asset.cost as string, accumulated, proceeds);
      const lines: LedgerLineInput[] = [
        { account: dto.receivedInto ?? 'bank', debit: received ? proceeds : '0.00' },
        { account: 'accumulated_depreciation', debit: accumulated },
        { account: 'fixed_assets_vehicles', credit: asset.cost as string },
      ];
      if (toCents(gainLoss) > 0n) lines.push({ account: 'gain_on_disposal', credit: gainLoss });
      if (toCents(gainLoss) < 0n) lines.push({ account: 'loss_on_disposal', debit: fromCents(-toCents(gainLoss)) });
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_disposed',
        sourceType: 'vehicle_disposal',
        sourceId: vehicleId,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.disposedOn),
        memo: `${v.registration_number} ${dto.method.replace('_', ' ')}${dto.buyer ? ` to ${dto.buyer.trim()}` : ''}: proceeds ${proceeds} against book value ${netBookValue}`,
        createdBy: userId,
        lines,
      });
      await this.repo.insertDisposal(client, {
        vehicleId,
        tenantId,
        disposedOn: dto.disposedOn,
        method: dto.method,
        proceeds,
        receivedInto: received ? dto.receivedInto! : null,
        netBookValue,
        gainLoss,
        buyer: clean(dto.buyer),
        entryId,
        userId,
      });
      await this.repo.setVehicleStatus(client, vehicleId, 'disposed');
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'vehicle_disposal', entityId: vehicleId, after: { ...dto, proceeds, netBookValue, gainLoss, entryId } });
      return this.detail(client, vehicleId);
    });
  }

  // ---- Loans ----

  private async loanView(client: PoolClient, l: Row): Promise<LoanView> {
    const outstanding = subtractMoney(l.principal as string, l.principal_repaid as string);
    const schedule =
      l.status === 'active'
        ? remainingSchedule(
            { annualRate: l.annual_rate as string, emi: l.emi as string, firstEmiOn: l.first_emi_on as string, tenureMonths: l.tenure_months as number },
            outstanding,
            (l.installments_paid as number) + 1,
          )
        : [];
    return {
      id: l.id as string,
      vehicleId: l.vehicle_id as string,
      lender: l.lender as string,
      accountNumber: l.account_number as string | null,
      principal: l.principal as string,
      annualRate: l.annual_rate as string,
      tenureMonths: l.tenure_months as number,
      emi: l.emi as string,
      disbursedOn: l.disbursed_on as string,
      firstEmiOn: l.first_emi_on as string,
      status: l.status as LoanView['status'],
      principalRepaid: l.principal_repaid as string,
      interestPaid: l.interest_paid as string,
      outstanding,
      version: l.version as number,
      payments: (await this.repo.loanPayments(client, l.id as string)).map((p) => ({
        installmentNo: p.installment_no as number,
        paidOn: p.paid_on as string,
        interest: p.interest as string,
        principal: p.principal as string,
        paidFrom: p.paid_from as 'bank' | 'cash_on_hand',
        reference: p.reference as string | null,
      })),
      schedule,
      nextDue: schedule[0] ?? null,
    };
  }

  listLoans(tenantId: string): Promise<(LoanView & { registrationNumber: string })[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const vehicles = new Map((await this.repo.vehicles(client, null)).map((v) => [v.vehicle_id as string, v.registration_number as string]));
      const out: (LoanView & { registrationNumber: string })[] = [];
      for (const l of await this.repo.loans(client, null)) {
        out.push({ ...(await this.loanView(client, l)), registrationNumber: vehicles.get(l.vehicle_id as string) ?? '' });
      }
      return out;
    });
  }

  /** The lender pays into the bank: Dr Bank / Cr Vehicle loans. */
  createLoan(tenantId: string, userId: string, dto: CreateLoanDto): Promise<VehicleDetail> {
    assertRealDate(dto.firstEmiOn, 'firstEmiOn');
    if (dto.firstEmiOn <= dto.disbursedOn) throw new BadRequestException('The first EMI falls after the disbursement');
    const principal = moneyFromNumber(dto.principal);
    const rate = dto.annualRate.toFixed(2);
    const emi = dto.emi !== undefined ? moneyFromNumber(dto.emi) : emiFor(principal, rate, dto.tenureMonths);
    if (compareMoney(emi, monthlyInterest(principal, rate)) <= 0) throw new BadRequestException("That EMI doesn't cover the first month's interest — the loan would never be repaid");
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.disbursedOn, 'disbursedOn', books, 'A disbursement');
      const v = await this.liveVehicle(client, dto.vehicleId);
      if (v.ownership === 'hired') throw new ConflictException(`${v.registration_number} is hired — its owner carries its loans`);
      const id = randomUUID();
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_loan_disbursed',
        sourceType: 'vehicle_loan',
        sourceId: id,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.disbursedOn),
        memo: `Loan from ${dto.lender.trim()} for ${v.registration_number}: ${principal} at ${rate}% over ${dto.tenureMonths} months`,
        createdBy: userId,
        lines: [
          { account: 'bank', debit: principal },
          { account: 'vehicle_loans', credit: principal },
        ],
      });
      await this.repo.insertLoan(client, {
        id,
        tenantId,
        vehicleId: dto.vehicleId,
        lender: dto.lender.trim(),
        accountNumber: clean(dto.accountNumber),
        principal,
        annualRate: rate,
        tenureMonths: dto.tenureMonths,
        emi,
        disbursedOn: dto.disbursedOn,
        firstEmiOn: dto.firstEmiOn,
        entryId,
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'vehicle_loan', entityId: id, after: { ...dto, principal, emi, entryId } });
      return this.detail(client, dto.vehicleId);
    });
  }

  /**
   * An EMI: the month's interest on what's outstanding first, the rest off
   * principal — Dr Vehicle loans (principal), Dr Interest (interest) / Cr
   * bank or cash. The loan closes when nothing is outstanding.
   */
  payEmi(tenantId: string, userId: string, loanId: string, dto: PayEmiDto): Promise<VehicleDetail> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.paidOn, 'paidOn', books, 'A payment');
      const l = await this.repo.loanForUpdate(client, loanId);
      if (!l) throw new NotFoundException('Loan not found');
      if (l.status !== 'active') throw new ConflictException('This loan is closed');
      if (l.version !== dto.version) throw new ConflictException('This loan was changed by someone else — reload and try again');
      if (dto.paidOn < (l.disbursed_on as string)) throw new BadRequestException(`The loan was disbursed on ${l.disbursed_on}`);
      const payments = await this.repo.loanPayments(client, loanId);
      const last = payments[payments.length - 1];
      if (last && dto.paidOn < (last.paid_on as string)) throw new BadRequestException(`The last installment was paid on ${last.paid_on}`);

      const outstanding = subtractMoney(l.principal as string, l.principal_repaid as string);
      const rate = l.annual_rate as string;
      const payoff = sumMoney([outstanding, monthlyInterest(outstanding, rate)]);
      // By default the EMI — or, on the tenure's last installment (or when less is left), what clears it.
      const finalInstallment = (l.installments_paid as number) + 1 >= (l.tenure_months as number);
      const amount = dto.amount !== undefined ? moneyFromNumber(dto.amount) : !finalInstallment && compareMoney(l.emi as string, payoff) < 0 ? (l.emi as string) : payoff;
      const split = splitPayment(outstanding, rate, amount);
      if (isPositiveMoney(split.excess)) throw new BadRequestException(`That's more than is owed — ${payoff} clears the loan`);

      const registration = (await this.vehicle(client, l.vehicle_id as string)).registration_number;
      const installmentNo = (l.installments_paid as number) + 1;
      const paymentId = randomUUID();
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_loan_emi_paid',
        sourceType: 'loan_payment',
        sourceId: paymentId,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.paidOn),
        memo: `EMI ${installmentNo} to ${l.lender} for ${registration}: interest ${split.interest}, principal ${split.principal}${dto.reference ? ` (${dto.reference.trim()})` : ''}`,
        createdBy: userId,
        lines: [
          { account: 'vehicle_loans', debit: split.principal },
          { account: 'loan_interest', debit: split.interest },
          { account: dto.paidFrom, credit: amount },
        ],
      });
      await this.repo.insertLoanPayment(client, {
        id: paymentId,
        tenantId,
        loanId,
        installmentNo,
        paidOn: dto.paidOn,
        interest: split.interest,
        principal: split.principal,
        paidFrom: dto.paidFrom,
        reference: clean(dto.reference),
        entryId,
        userId,
      });
      const cleared = compareMoney(split.principal, outstanding) === 0;
      await this.repo.touchLoan(client, loanId, cleared);
      await this.audit.record(client, {
        tenantId,
        actorUserId: userId,
        action: 'create',
        entityType: 'loan_payment',
        entityId: paymentId,
        after: { installmentNo, paidOn: dto.paidOn, amount, ...split, entryId, closed: cleared },
      });
      return this.detail(client, l.vehicle_id as string);
    });
  }

  // ---- Hired vehicles ----

  addHireContract(tenantId: string, userId: string, vehicleId: string, dto: HireContractDto): Promise<VehicleDetail> {
    assertRealDate(dto.effectiveFrom, 'effectiveFrom');
    return this.db.withTenant(tenantId, async (client) => {
      const v = await this.liveVehicle(client, vehicleId);
      if (v.ownership !== 'hired') throw new ConflictException(`Mark ${v.registration_number} as hired first`);
      const billed = await this.repo.overlappingBill(client, vehicleId, dto.effectiveFrom, '9999-12-31');
      if (billed) throw new ConflictException(`Hire is billed through ${billed.period_end} — a new rate can start after that`);
      try {
        await this.repo.insertContract(client, {
          tenantId,
          vehicleId,
          ownerName: dto.ownerName.trim(),
          ownerPan: dto.ownerPan ?? null,
          ownerPhone: clean(dto.ownerPhone),
          rateBasis: dto.rateBasis,
          rate: moneyFromNumber(dto.rate),
          includesFuel: dto.includesFuel,
          effectiveFrom: dto.effectiveFrom,
          userId,
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new ConflictException(`There is already a contract from ${dto.effectiveFrom}`);
        throw err;
      }
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'hire_contract', entityId: vehicleId, after: { ...dto } });
      return this.detail(client, vehicleId);
    });
  }

  private contractCovering(contracts: HireContract[], from: string, to: string): HireContract | null {
    return contracts.find((c) => c.effectiveFrom <= from && (!c.effectiveTo || c.effectiveTo >= to)) ?? null;
  }

  /** What the owner's bill for a period should come to, counted from the trips the vehicle ran. */
  suggestHire(tenantId: string, vehicleId: string, from: string, to: string): Promise<HireSuggestion> {
    this.range(from, to);
    return this.db.withTenant(tenantId, async (client) => {
      await this.vehicle(client, vehicleId);
      const contracts = await this.repo.contracts(client, vehicleId);
      const contract = this.contractCovering(contracts, from, to);
      const [use] = await this.repo.tripUse(client, vehicleId, from, to);
      const trips = use?.trips ?? 0;
      const days = use?.days ?? 0;
      const overlap = await this.repo.overlappingBill(client, vehicleId, from, to);
      const overlapping = overlap ? `Already billed ${overlap.period_start} to ${overlap.period_end}` : null;
      if (!contract) {
        return { contract: null, rateBasis: null, quantity: null, basis: 'No single contract covers the whole period — bill each rate separately', trips, days, overlapping };
      }
      let quantity: string | null = null;
      let basis: string;
      switch (contract.rateBasis) {
        case 'per_trip':
          quantity = `${trips}.000`;
          basis = `${trips} completed trip${trips === 1 ? '' : 's'}`;
          break;
        case 'per_day':
          quantity = `${days}.000`;
          basis = `${days} day${days === 1 ? '' : 's'} with a trip`;
          break;
        case 'per_month': {
          const whole = from.endsWith('-01') && to === lastOfMonth(firstOfMonth(to));
          if (whole) {
            let n = 0;
            for (let m = firstOfMonth(from); m <= firstOfMonth(to); m = addMonths(m, 1)) n += 1;
            quantity = `${n}.000`;
            basis = `${n} calendar month${n === 1 ? '' : 's'}`;
          } else {
            basis = 'Not whole calendar months — enter the share of the month';
          }
          break;
        }
        default:
          basis = "Enter the km from the owner's bill";
      }
      return { contract, rateBasis: contract.rateBasis, quantity, basis, trips, days, overlapping };
    });
  }

  listHireBills(tenantId: string, status?: string, vehicleId?: string): Promise<HireBill[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.bills(client, vehicleId ?? null, status ?? null));
  }

  /** The owner's bill, owed until paid: Dr Hired vehicle charges / Cr Payable to vehicle owners. */
  recordHireBill(tenantId: string, userId: string, dto: RecordHireBillDto): Promise<HireBill> {
    this.range(dto.periodStart, dto.periodEnd);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.periodEnd, 'periodEnd', books, 'A hire period');
      const v = await this.vehicle(client, dto.vehicleId);
      if (v.ownership !== 'hired') throw new ConflictException(`${v.registration_number} isn't a hired vehicle`);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('fleet.hire'), hashtext($1))`, [dto.vehicleId]);
      const contract = this.contractCovering(await this.repo.contracts(client, dto.vehicleId), dto.periodStart, dto.periodEnd);
      if (!contract) throw new ConflictException('No single contract covers the whole period — bill each rate separately');
      const overlap = await this.repo.overlappingBill(client, dto.vehicleId, dto.periodStart, dto.periodEnd);
      if (overlap) throw new ConflictException(`${overlap.period_start} to ${overlap.period_end} is already billed`);
      const quantity = dto.quantity.toFixed(3);
      const amount = dto.amount !== undefined ? moneyFromNumber(dto.amount) : multiplyToMoney(quantity, contract.rate);
      if (!isPositiveMoney(amount)) throw new BadRequestException('The bill comes to nothing');
      const id = randomUUID();
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_hire_billed',
        sourceType: 'hire_bill',
        sourceId: id,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.periodEnd),
        memo: `Hire of ${v.registration_number} from ${contract.ownerName}, ${dto.periodStart} to ${dto.periodEnd}: ${quantity} × ${contract.rate}${dto.billReference ? ` (bill ${dto.billReference.trim()})` : ''}`,
        createdBy: userId,
        lines: [
          { account: 'vehicle_hire_charges', debit: amount },
          { account: 'hire_payable', credit: amount },
        ],
      });
      await this.repo.insertBill(client, {
        id,
        tenantId,
        vehicleId: dto.vehicleId,
        contractId: contract.id,
        from: dto.periodStart,
        to: dto.periodEnd,
        quantity,
        rate: contract.rate,
        amount,
        billReference: clean(dto.billReference),
        entryId,
        userId,
      });
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'create', entityType: 'hire_bill', entityId: id, after: { ...dto, quantity, amount, entryId } });
      return (await this.repo.findBill(client, id))!;
    });
  }

  /**
   * Paying the owner, TDS withheld when a section is chosen (194C for
   * transport contracts; a small transporter who has declared ≤ 10 goods
   * carriages and given a PAN is exempt — then choose none):
   *   Dr Payable to vehicle owners (bill) / Cr bank or cash (net) / Cr TDS payable.
   * The deduction lands in the TDS register for the quarter's return.
   */
  payHireBill(tenantId: string, userId: string, billId: string, dto: PayHireBillDto): Promise<HireBill> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      this.notFuture(dto.paidOn, 'paidOn', books, 'A payment');
      const bill = await this.repo.findBill(client, billId);
      if (!bill) throw new NotFoundException('Hire bill not found');
      if (bill.status !== 'unpaid') throw new ConflictException('This bill is already paid');
      const contract = (await this.repo.contracts(client, bill.vehicleId)).find((c) => c.id === bill.contractId)!;

      let tds = '0.00';
      let section: Awaited<ReturnType<TaxRulesRepository['tdsSection']>> = null;
      let deducteeType: DeducteeType = 'no_pan';
      let rate = '0';
      if (dto.tdsSectionCode) {
        section = await this.taxRulesRepo.tdsSection(client, dto.tdsSectionCode.trim(), dto.paidOn);
        if (!section) throw new BadRequestException(`There is no TDS section ${dto.tdsSectionCode} in force on ${dto.paidOn}`);
        deducteeType = contract.ownerPan ? deducteeTypeFromPan(contract.ownerPan) : 'no_pan';
        rate = deducteeType === 'no_pan' ? section.rateNoPan : deducteeType === 'individual_huf' ? section.rateIndividual : section.rateOther;
        tds = percentOfMoney(bill.amount, rate);
        if (!isPositiveMoney(tds)) throw new BadRequestException(`At ${rate}% there is no tax to withhold on this bill`);
      }
      const net = subtractMoney(bill.amount, tds);
      const entryId = await this.ledger.postSystemWithClient(client, {
        tenantId,
        entryType: 'vehicle_hire_paid',
        sourceType: 'hire_bill_payment',
        sourceId: billId,
        occurredAt: await this.repo.instant(client, books.timezone, books.today, dto.paidOn),
        memo: `Paid ${contract.ownerName} for ${bill.registrationNumber}, ${bill.periodStart} to ${bill.periodEnd}${section ? ` — TDS ${tds} under ${section.code}` : ''}`,
        createdBy: userId,
        lines: [
          { account: 'hire_payable', debit: bill.amount },
          { account: dto.paidFrom, credit: net },
          { account: 'tds_payable', credit: tds },
        ],
      });
      if (section) {
        await this.taxRules.recordDeductionWithClient(client, {
          tenantId,
          sectionId: section.id,
          sectionCode: section.code,
          farmerId: null,
          payeeName: contract.ownerName,
          payeePan: contract.ownerPan,
          deducteeType,
          baseAmount: bill.amount,
          grossAmount: bill.amount,
          rate,
          tdsAmount: tds,
          deductedOn: dto.paidOn,
          payableId: null,
          sourceType: 'hire_bill_payment',
          sourceId: billId,
          ledgerEntryId: entryId,
          createdBy: userId,
        });
      }
      const ok = await this.repo.markBillPaid(client, billId, dto.version, {
        paidOn: dto.paidOn,
        paidFrom: dto.paidFrom,
        tdsAmount: tds,
        tdsSection: section?.code ?? null,
        entryId,
      });
      if (!ok) throw new ConflictException('This bill was changed by someone else — reload and try again');
      await this.audit.record(client, { tenantId, actorUserId: userId, action: 'update', entityType: 'hire_bill', entityId: billId, before: { status: 'unpaid' }, after: { status: 'paid', ...dto, tds, net, entryId } });
      return (await this.repo.findBill(client, billId))!;
    });
  }

  // ---- Economics ----

  private range(from: string, to: string): void {
    assertRealDate(from, 'from');
    assertRealDate(to, 'to');
    if (from > to) throw new BadRequestException('from must be on or before to');
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException(`A range covers at most ${MAX_RANGE_DAYS} days`);
  }

  /**
   * What each vehicle cost to run over a period, and per trip and per km.
   * Fuel is the fuel log plus fuel spent on its trips; depreciation is the
   * months that begin in the period; hire is bills whose period ends in it.
   */
  economics(tenantId: string, from: string, to: string): Promise<EconomicsReport> {
    this.range(from, to);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.repo.books(client);
      const costs = await this.repo.costs(client, from, to);
      const use = new Map((await this.repo.tripUse(client, null, from, to)).map((u) => [u.vehicle_id, u]));
      const fills = await this.repo.fuel(client, null, from, to);
      const rows: EconomicsRow[] = [];
      for (const c of costs) {
        const id = c.vehicle_id as string;
        const u = use.get(id);
        const economy = fuelEconomy(fills.filter((f) => f.vehicleId === id));
        const fuel = sumMoney([c.fuel_logged as string, c.fuel_on_trips as string]);
        const parts = {
          fuel,
          maintenance: c.maintenance as string,
          documents: c.documents as string,
          depreciation: c.depreciation as string,
          loanInterest: c.loan_interest as string,
          hire: c.hire as string,
        };
        const total = sumMoney(Object.values(parts));
        const trips = u?.trips ?? 0;
        if (trips === 0 && !isPositiveMoney(total)) continue; // nothing happened
        rows.push({
          vehicleId: id,
          registrationNumber: c.registration_number as string,
          ownership: c.ownership as EconomicsRow['ownership'],
          trips,
          daysUsed: u?.days ?? 0,
          km: economy.km,
          litres: c.litres as string,
          kmPerLitre: economy.kmPerLitre,
          ...parts,
          total,
          costPerTrip: trips > 0 ? divide(total, trips) : null,
          costPerKm: economy.km ? divide(total, economy.km) : null,
        });
      }
      const sum = (k: keyof EconomicsRow) => sumMoney(rows.map((r) => r[k] as string));
      return {
        currency: books.currency,
        from,
        to,
        rows,
        totals: {
          trips: rows.reduce((s, r) => s + r.trips, 0),
          daysUsed: rows.reduce((s, r) => s + r.daysUsed, 0),
          km: rows.some((r) => r.km !== null) ? rows.reduce((s, r) => s + (r.km ?? 0), 0) : null,
          litres: sumLitres(rows.map((r) => r.litres)),
          fuel: sum('fuel'),
          maintenance: sum('maintenance'),
          documents: sum('documents'),
          depreciation: sum('depreciation'),
          loanInterest: sum('loanInterest'),
          hire: sum('hire'),
          total: sum('total'),
        },
      };
    });
  }
}

/** Litres to 3 dp, summed exactly. */
function sumLitres(values: string[]): string {
  const milli = values.reduce((s, v) => {
    const [w, f = ''] = v.split('.');
    return s + BigInt(w) * 1000n + BigInt((f + '000').slice(0, 3));
  }, 0n);
  return `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, '0')}`;
}

/** Money ÷ a count, half-up to the paisa. */
function divide(amount: string, by: number): string {
  const c = toCents(amount);
  const d = BigInt(by);
  const q = (c * 2n + d) / (d * 2n);
  return fromCents(q);
}
