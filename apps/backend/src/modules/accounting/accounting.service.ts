import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { assertRealDate, daysInclusive } from '../../common/period';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { compareMoney, fromCents, moneyFromNumber, subtractMoney, sumMoney, toCents } from '../../common/money';
import { AccountRow, AccountingRepository, EntryRow, LineRow, TenantBooks } from './repositories/accounting.repository';
import {
  AccountRecord,
  AccountingTrialBalance,
  BalanceSheet,
  CashFlowActivity,
  CashFlowStatement,
  ClosePreview,
  GeneralLedger,
  GROUPS_BY_ROOT,
  JournalEntry,
  normalSide,
  PeriodsOverview,
  ProfitAndLoss,
  ProfitAndLossFigures,
  ReportGroup,
  StatementLine,
  StatementSection,
} from './entities/accounting.entity';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';
import { ClosePeriodDto, CreateJournalDto, ListJournalQueryDto, ReopenPeriodDto, ReverseJournalDto } from './dto/journal.dto';

const ACCOUNT_ENTITY = 'account';
const JOURNAL_ENTITY = 'manual_journal';
const PERIOD_ENTITY = 'period_close';

const GENERAL_LEDGER_LIMIT = 2000;
const MAX_REPORT_DAYS = 1830; // five years
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const SECTION_LABEL: Record<ReportGroup, string> = {
  cash: 'Cash and bank',
  current_asset: 'Current assets',
  fixed_asset: 'Fixed assets',
  current_liability: 'Current liabilities',
  long_term_liability: 'Long-term liabilities',
  equity: 'Equity',
  sales: 'Sales',
  contra_sales: 'Less: returns and allowances',
  other_income: 'Other income',
  cost_of_sales: 'Cost of sales',
  operating_expense: 'Operating expenses',
  finance_cost: 'Finance costs',
  other_expense: 'Other expenses',
};

const PNL_ORDER: ReportGroup[] = [
  'sales',
  'contra_sales',
  'cost_of_sales',
  'operating_expense',
  'other_income',
  'finance_cost',
  'other_expense',
];

// What a cash movement against a system account means, for the cash-flow
// statement. A tenant's own accounts are labelled by their name.
const CASH_LABEL: Record<string, string> = {
  accounts_receivable: 'Collected from customers',
  accounts_payable_farmer: 'Paid to farmers for graded produce',
  farmer_advance: 'Advances paid to farmers',
  cash_with_drivers: 'Trip cash floats (advances less returns)',
  cash_shortage: 'Trip cash shortages',
  cash_over: 'Trip cash overages',
  finance_costs: 'Bank charges, interest, and fees',
  revenue_sales: 'Cash sales',
  owner_capital: 'Capital introduced by the owner',
  owner_drawings: 'Drawings by the owner',
  fixed_assets_vehicles: 'Vehicles bought or sold',
};

/** An amount on an account's normal side, from its debit − credit net. */
function natural(net: string, root: AccountRow['root_type']): string {
  return normalSide(root) === 'debit' ? net : subtractMoney('0', net);
}

function isZero(value: string): boolean {
  return toCents(value) === 0n;
}

/** 2026-09-26 → "26 Sep 2026", the form the database's lock message uses. */
function readableDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    code: row.code,
    number: row.number,
    name: row.name,
    rootType: row.root_type,
    reportGroup: row.report_group,
    normalSide: normalSide(row.root_type),
    isSystem: row.is_system,
    isControl: row.is_control,
    isActive: row.is_active,
    description: row.description,
    version: row.version,
    balance: natural(row.net, row.root_type),
  };
}

function toJournalEntry(row: EntryRow, lines: LineRow[]): JournalEntry {
  return {
    id: row.id,
    entryType: row.entry_type,
    journalNumber: row.journal_number,
    reference: row.reference,
    sourceType: row.source_type,
    sourceId: row.source_id,
    occurredAt: row.occurred_at,
    date: row.date,
    memo: row.memo,
    reversesEntryId: row.reverses_entry_id,
    reversedByEntryId: row.reversed_by_entry_id,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    total: row.total ?? '0.00',
    lines: lines.map((l) => ({
      accountCode: l.account_code,
      accountNumber: l.account_number,
      accountName: l.account_name,
      partyType: l.party_type,
      partyId: l.party_id,
      partyName: l.party_name,
      debit: l.debit,
      credit: l.credit,
    })),
  };
}

/** "Cold storage — Vashi" → "cold_storage_vashi". */
function codeFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (slug.length < 2) return 'account';
  return /^[a-z]/.test(slug) ? slug : `a_${slug}`.slice(0, 50);
}

/**
 * The Accounting context: the tenant's chart of accounts, manual journals
 * and their reversals, the general ledger, the trial balance, the P&L, the
 * balance sheet, the cash-flow statement, and period closing — all over
 * Finance's single append-only ledger (Accounting Engine, DE.1–DE.5).
 * Postings go through Finance's LedgerService, in the same transaction as
 * the record that caused them.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AccountingRepository,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // ---- Shared ----

  private async books(client: PoolClient): Promise<TenantBooks> {
    const books = await this.repo.books(client);
    if (!books) throw new NotFoundException('Tenant not found');
    return books;
  }

  /**
   * A report's date range, tenant-local. Explicit from/to win; `days`
   * means that many days ending on `to`; otherwise month to date — how an
   * owner reads a P&L.
   */
  private range(books: TenantBooks, query: PeriodQueryDto, fallback: 'month' | 'last30' = 'month'): { from: string; to: string } {
    if (query.from) assertRealDate(query.from, 'from');
    if (query.to) assertRealDate(query.to, 'to');
    const to = query.to ?? books.today;
    const from =
      query.from ??
      (query.days
        ? addDays(to, -(query.days - 1))
        : fallback === 'month'
          ? `${to.slice(0, 8)}01`
          : addDays(to, -29));
    if (from > to) throw new BadRequestException('from must be on or before to');
    if (daysInclusive(from, to) > MAX_REPORT_DAYS) {
      throw new BadRequestException(`A report can cover at most ${MAX_REPORT_DAYS} days`);
    }
    return { from, to };
  }

  private asOf(books: TenantBooks, asOf: string | undefined): string {
    if (asOf) assertRealDate(asOf, 'asOf');
    return asOf ?? books.today;
  }

  // ---- Chart of accounts ----

  listAccounts(tenantId: string, includeInactive: boolean): Promise<AccountRecord[]> {
    return this.db.withTenant(tenantId, async (client) =>
      (await this.repo.listAccounts(client, includeInactive)).map(toAccountRecord),
    );
  }

  private async accountOrThrow(client: PoolClient, code: string): Promise<AccountRow> {
    const row = await this.repo.findAccount(client, code);
    if (!row) throw new NotFoundException('Account not found');
    return row;
  }

  async createAccount(tenantId: string, actorUserId: string, dto: CreateAccountDto): Promise<AccountRecord> {
    if (!GROUPS_BY_ROOT[dto.rootType].includes(dto.reportGroup)) {
      throw new BadRequestException(`A ${dto.rootType} account can't go under ${SECTION_LABEL[dto.reportGroup]}`);
    }
    const name = dto.name.trim();
    return this.db.withTenant(tenantId, async (client) => {
      if (await this.repo.accountNumberTaken(client, dto.number)) {
        throw new ConflictException(`Account number ${dto.number} is already used`);
      }
      const base = codeFromName(name);
      const taken = new Set(await this.repo.codesLike(client, base));
      let code = base;
      for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;

      await this.repo.insertAccount(client, tenantId, actorUserId, {
        code,
        number: dto.number,
        name,
        rootType: dto.rootType,
        reportGroup: dto.reportGroup,
        description: dto.description?.trim() || null,
      });
      const created = await this.accountOrThrow(client, code);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ACCOUNT_ENTITY,
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return toAccountRecord(created);
    });
  }

  updateAccount(tenantId: string, actorUserId: string, code: string, dto: UpdateAccountDto): Promise<AccountRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.accountOrThrow(client, code);
      if (dto.isActive === false && before.is_active) {
        if (before.is_system) throw new ConflictException(`${before.name} is used by the system and can't be retired`);
        if (!isZero(before.net)) {
          throw new ConflictException(`${before.name} still has a balance — move it to another account with a journal first`);
        }
      }
      if (dto.number !== undefined && dto.number !== before.number && (await this.repo.accountNumberTaken(client, dto.number, code))) {
        throw new ConflictException(`Account number ${dto.number} is already used`);
      }
      const updated = await this.repo.updateAccount(client, code, dto.version, {
        number: dto.number,
        name: dto.name?.trim(),
        description: dto.description,
        isActive: dto.isActive,
      });
      if (!updated) throw new ConflictException('This account was changed by someone else — reload it and try again');
      const after = await this.accountOrThrow(client, code);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: before.is_active && !after.is_active ? 'archive' : !before.is_active && after.is_active ? 'restore' : 'update',
        entityType: ACCOUNT_ENTITY,
        entityId: before.id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return toAccountRecord(after);
    });
  }

  // ---- Journal entries ----

  private async entryOrThrow(client: PoolClient, timezone: string, id: string): Promise<JournalEntry> {
    const row = await this.repo.findEntry(client, timezone, id);
    if (!row) throw new NotFoundException('Journal entry not found');
    return toJournalEntry(row, await this.repo.linesFor(client, [id]));
  }

  getEntry(tenantId: string, id: string): Promise<JournalEntry> {
    return this.db.withTenant(tenantId, async (client) => this.entryOrThrow(client, (await this.books(client)).timezone, id));
  }

  listEntries(tenantId: string, query: ListJournalQueryDto): Promise<PaginatedResult<JournalEntry> & { from: string; to: string }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const { from, to } = this.range(books, query, 'last30');
      const { startAt, endAt } = await this.repo.instants(client, books.timezone, from, to);
      const { rows, total } = await this.repo.listEntries(client, books.timezone, {
        startAt,
        endAt,
        accountCode: query.accountCode,
        manualOnly: query.manualOnly ?? false,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      const lines = await this.repo.linesFor(client, rows.map((r) => r.id));
      return {
        items: rows.map((row) => toJournalEntry(row, lines.filter((l) => l.entry_id === row.id))),
        total,
        page,
        pageSize,
        from,
        to,
      };
    });
  }

  /**
   * A journal a person posts: opening balances, rent, salaries, capital,
   * depreciation, corrections. It must balance, use only active accounts
   * the tenant has, stay off control accounts (their sub-ledgers —
   * invoices, payables, lots — would stop agreeing with the ledger), and
   * be dated in an open period and not in the future.
   */
  async createJournal(tenantId: string, actorUserId: string, dto: CreateJournalDto): Promise<JournalEntry> {
    assertRealDate(dto.date, 'date');
    const lines = dto.lines.map((line, i) => {
      const debit = moneyFromNumber(line.debit ?? 0);
      const credit = moneyFromNumber(line.credit ?? 0);
      if (isZero(debit) === isZero(credit)) {
        throw new BadRequestException(`Line ${i + 1} needs an amount on exactly one side — debit or credit`);
      }
      return { account: line.accountCode, debit, credit };
    });
    const debits = sumMoney(lines.map((l) => l.debit));
    const credits = sumMoney(lines.map((l) => l.credit));
    if (compareMoney(debits, credits) !== 0) {
      throw new BadRequestException(`Debits (${debits}) and credits (${credits}) must be equal`);
    }
    const sides = new Set(lines.map((l) => `${l.account}:${isZero(l.debit) ? 'cr' : 'dr'}`));
    const accounts = [...new Set(lines.map((l) => l.account))];
    if (accounts.length === 1 || sides.size < 2) {
      throw new BadRequestException('A journal must move amounts between at least two accounts');
    }

    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      if (dto.date > books.today) throw new BadRequestException("A journal can't be dated in the future");
      await this.assertOpen(client, dto.date);
      const found = new Map((await this.repo.findAccounts(client, accounts)).map((a) => [a.code, a]));
      for (const code of accounts) {
        const account = found.get(code);
        if (!account) throw new BadRequestException(`There is no account ${code} in your chart`);
        if (!account.is_active) throw new BadRequestException(`${account.name} is retired`);
        if (account.is_control) {
          throw new BadRequestException(
            `${account.name} is a control account kept by its own records (invoices, payables, stock, advances) — it can't take a manual journal`,
          );
        }
      }

      const journalId = randomUUID();
      const journalNumber = await this.repo.nextJournalNumber(client);
      const memo = dto.memo.trim();
      await this.repo.insertManualJournal(client, {
        id: journalId,
        tenantId,
        journalNumber,
        entryDate: dto.date,
        reference: dto.reference?.trim() || null,
        memo,
        createdBy: actorUserId,
      });
      const entryId = await this.ledger.postManualWithClient(client, {
        tenantId,
        entryType: 'manual_journal',
        sourceType: JOURNAL_ENTITY,
        sourceId: journalId,
        occurredAt: await this.repo.journalInstant(client, books.timezone, dto.date),
        memo,
        createdBy: actorUserId,
        lines,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: JOURNAL_ENTITY,
        entityId: journalId,
        after: { journalNumber, date: dto.date, memo, reference: dto.reference ?? null, lines, entryId },
      });
      return this.entryOrThrow(client, books.timezone, entryId);
    });
  }

  /**
   * Corrects a manual journal the only way the ledger allows (DE.4): a new
   * entry with every line on the other side, linked to the original. Only
   * manual journals — an invoice, payment, or grading entry is corrected
   * through its own record (a payment reversal, a credit note), so its
   * sub-ledger moves with it.
   */
  async reverseJournal(tenantId: string, actorUserId: string, entryId: string, dto: ReverseJournalDto): Promise<JournalEntry> {
    if (dto.date) assertRealDate(dto.date, 'date');
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const original = await this.entryOrThrow(client, books.timezone, entryId);
      if (original.entryType !== 'manual_journal') {
        throw new ConflictException(
          'Only manual journals can be reversed here — other entries are corrected through the record that made them',
        );
      }
      if (original.reversedByEntryId) throw new ConflictException('This journal has already been reversed');
      const date = dto.date ?? books.today;
      if (date > books.today) throw new BadRequestException("A reversal can't be dated in the future");
      if (date < original.date) throw new BadRequestException('A reversal must be dated on or after the journal it reverses');
      await this.assertOpen(client, date);

      const memo = dto.memo?.trim() || `Reversal of journal #${original.journalNumber}: ${original.memo ?? ''}`.trim();
      const reversalId = await this.ledger.postManualWithClient(client, {
        tenantId,
        entryType: 'journal_reversal',
        sourceType: 'ledger_entry',
        sourceId: original.id,
        reversesEntryId: original.id,
        occurredAt: await this.repo.journalInstant(client, books.timezone, date),
        memo,
        createdBy: actorUserId,
        lines: original.lines.map((l) => ({ account: l.accountCode, debit: l.credit, credit: l.debit })),
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: JOURNAL_ENTITY,
        entityId: original.sourceId,
        before: { entryId: original.id },
        after: { reversedByEntryId: reversalId, date, memo },
      });
      return this.entryOrThrow(client, books.timezone, reversalId);
    });
  }

  /** A friendlier early answer than the database's lock (which still has the last word). */
  private async assertOpen(client: PoolClient, date: string): Promise<void> {
    const locked = await this.repo.lockedThrough(client);
    if (locked && date <= locked) {
      throw new ConflictException(
        `The books are closed through ${readableDate(locked)}. Date it after that, or reopen the period first.`,
      );
    }
  }

  // ---- General ledger ----

  getGeneralLedger(tenantId: string, code: string, query: PeriodQueryDto): Promise<GeneralLedger> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const account = await this.accountOrThrow(client, code);
      const { from, to } = this.range(books, query);
      const { startAt, endAt } = await this.repo.instants(client, books.timezone, from, to);
      const movement = await this.repo.accountMovement(client, code, startAt as Date, endAt);
      const rows = await this.repo.accountLines(client, books.timezone, code, startAt as Date, endAt, GENERAL_LEDGER_LIMIT + 1);
      const truncated = rows.length > GENERAL_LEDGER_LIMIT;

      const debitNormal = normalSide(account.root_type) === 'debit';
      let running = toCents(natural(movement.opening, account.root_type));
      const lines = rows.slice(0, GENERAL_LEDGER_LIMIT).map((row) => {
        const change = toCents(row.debit) - toCents(row.credit);
        running += debitNormal ? change : -change;
        return {
          entryId: row.entry_id,
          occurredAt: row.occurred_at,
          date: row.date,
          entryType: row.entry_type,
          memo: row.memo,
          journalNumber: row.journal_number,
          partyName: row.party_name,
          debit: row.debit,
          credit: row.credit,
          balance: fromCents(running),
        };
      });
      const opening = natural(movement.opening, account.root_type);
      const change = subtractMoney(movement.debit, movement.credit);
      return {
        currency: books.currency,
        account: toAccountRecord(account),
        from,
        to,
        opening,
        totals: { debit: movement.debit, credit: movement.credit },
        closing: sumMoney([opening, debitNormal ? change : subtractMoney('0', change)]),
        lines,
        truncated,
      };
    });
  }

  // ---- Trial balance ----

  getTrialBalance(tenantId: string, asOf?: string): Promise<AccountingTrialBalance> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const date = this.asOf(books, asOf);
      const { endAt } = await this.repo.instants(client, books.timezone, null, date);
      const rows = (await this.repo.balances(client, null, endAt, false)).filter((r) => !isZero(r.net));
      const lines = rows.map((r) => {
        const debitSide = compareMoney(r.net, '0') > 0;
        return {
          code: r.code,
          number: r.number,
          name: r.name,
          rootType: r.root_type,
          debit: debitSide ? r.net : '0.00',
          credit: debitSide ? '0.00' : subtractMoney('0', r.net),
        };
      });
      const debit = sumMoney(lines.map((l) => l.debit));
      const credit = sumMoney(lines.map((l) => l.credit));
      return { currency: books.currency, asOf: date, lines, totals: { debit, credit }, balanced: compareMoney(debit, credit) === 0 };
    });
  }

  // ---- Profit and loss ----

  private async pnl(client: PoolClient, books: TenantBooks, from: string, to: string): Promise<{ sections: StatementSection[]; figures: ProfitAndLossFigures }> {
    const { startAt, endAt } = await this.repo.instants(client, books.timezone, from, to);
    const rows = await this.repo.balances(client, startAt, endAt, true);
    const sections = PNL_ORDER.map((group) => {
      const lines: StatementLine[] = rows
        .filter((r) => r.report_group === group && !isZero(r.net))
        // Revenue reads as credit − debit, expenses as debit − credit; a
        // contra-revenue account therefore shows negative, reducing sales.
        .map((r) => ({ code: r.code, number: r.number, name: r.name, amount: natural(r.net, r.root_type) }));
      return { key: group, label: SECTION_LABEL[group], lines, total: sumMoney(lines.map((l) => l.amount)) };
    });
    const total = (group: ReportGroup) => sections.find((s) => s.key === group)?.total ?? '0.00';
    const netSales = sumMoney([total('sales'), total('contra_sales')]);
    const grossProfit = subtractMoney(netSales, total('cost_of_sales'));
    const operatingProfit = subtractMoney(grossProfit, total('operating_expense'));
    const netProfit = subtractMoney(
      sumMoney([operatingProfit, total('other_income')]),
      sumMoney([total('finance_cost'), total('other_expense')]),
    );
    return {
      sections,
      figures: {
        netSales,
        costOfSales: total('cost_of_sales'),
        grossProfit,
        operatingExpenses: total('operating_expense'),
        operatingProfit,
        otherIncome: total('other_income'),
        financeCosts: total('finance_cost'),
        otherExpenses: total('other_expense'),
        netProfit,
      },
    };
  }

  getProfitAndLoss(tenantId: string, query: PeriodQueryDto): Promise<ProfitAndLoss> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const { from, to } = this.range(books, query);
      const days = daysInclusive(from, to);
      const previousTo = addDays(from, -1);
      const previousFrom = addDays(previousTo, -(days - 1));
      const current = await this.pnl(client, books, from, to);
      const previous = await this.pnl(client, books, previousFrom, previousTo);
      return {
        currency: books.currency,
        from,
        to,
        sections: current.sections,
        figures: current.figures,
        previous: { from: previousFrom, to: previousTo, figures: previous.figures },
      };
    });
  }

  // ---- Balance sheet ----

  getBalanceSheet(tenantId: string, asOf?: string): Promise<BalanceSheet> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const date = this.asOf(books, asOf);
      const { endAt } = await this.repo.instants(client, books.timezone, null, date);
      const rows = await this.repo.balances(client, null, endAt, false);
      const section = (group: ReportGroup): StatementSection => {
        const lines = rows
          .filter((r) => r.report_group === group && !isZero(r.net))
          .map((r) => ({ code: r.code, number: r.number, name: r.name, amount: natural(r.net, r.root_type) }));
        return { key: group, label: SECTION_LABEL[group], lines, total: sumMoney(lines.map((l) => l.amount)) };
      };
      const assetSections = GROUPS_BY_ROOT.asset.map(section);
      const liabilitySections = GROUPS_BY_ROOT.liability.map(section);
      const equity = section('equity');
      // Revenue less expenses still sitting in their own accounts — profit
      // no period close has yet moved to retained earnings.
      const unclosedProfit = sumMoney(
        rows.filter((r) => r.root_type === 'revenue' || r.root_type === 'expense').map((r) => subtractMoney('0', r.net)),
      );
      const totalAssets = sumMoney(assetSections.map((s) => s.total));
      const totalLiabilities = sumMoney(liabilitySections.map((s) => s.total));
      const totalEquity = sumMoney([equity.total, unclosedProfit]);
      const liabilitiesAndEquity = sumMoney([totalLiabilities, totalEquity]);
      return {
        currency: books.currency,
        asOf: date,
        assets: { sections: assetSections, total: totalAssets },
        liabilities: { sections: liabilitySections, total: totalLiabilities },
        equity: { lines: equity.lines, unclosedProfit, total: totalEquity },
        liabilitiesAndEquity,
        balanced: compareMoney(totalAssets, liabilitiesAndEquity) === 0,
      };
    });
  }

  // ---- Cash flow ----

  getCashFlowStatement(tenantId: string, query: PeriodQueryDto): Promise<CashFlowStatement> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const { from, to } = this.range(books, query);
      const { startAt, endAt } = await this.repo.instants(client, books.timezone, from, to);
      const before = (await this.repo.balances(client, null, startAt as Date, false)).filter((r) => r.report_group === 'cash');
      const after = (await this.repo.balances(client, null, endAt, false)).filter((r) => r.report_group === 'cash');
      const counterparts = await this.repo.cashCounterparts(client, startAt as Date, endAt);

      const activityOf = (group: ReportGroup): CashFlowActivity =>
        group === 'fixed_asset' ? 'investing' : group === 'equity' || group === 'long_term_liability' ? 'financing' : 'operating';
      const activities = (['operating', 'investing', 'financing'] as CashFlowActivity[]).map((activity) => {
        const lines = counterparts
          .filter((c) => activityOf(c.report_group) === activity)
          .map((c) => ({ code: c.code, name: c.name, label: CASH_LABEL[c.code] ?? c.name, amount: c.amount }));
        return { activity, lines, total: sumMoney(lines.map((l) => l.amount)) };
      });
      const openingCash = sumMoney(before.map((r) => r.net));
      const closingCash = sumMoney(after.map((r) => r.net));
      return {
        currency: books.currency,
        from,
        to,
        openingCash,
        closingCash,
        netChange: subtractMoney(closingCash, openingCash),
        activities,
        cashAccounts: after
          .filter((r) => r.is_active || !isZero(r.net))
          .map((r) => ({
            code: r.code,
            name: r.name,
            opening: before.find((b) => b.code === r.code)?.net ?? '0.00',
            closing: r.net,
          })),
      };
    });
  }

  // ---- Periods ----

  getPeriods(tenantId: string): Promise<PeriodsOverview> {
    return this.db.withTenant(tenantId, async (client) => {
      const books = await this.books(client);
      const closes = await this.repo.listCloses(client);
      return {
        currency: books.currency,
        lockedThrough: await this.repo.lockedThrough(client),
        today: books.today,
        closes: closes.map((c) => ({
          id: c.id,
          periodStart: c.period_start,
          periodEnd: c.period_end,
          netIncome: c.net_income,
          closingEntryId: c.closing_entry_id,
          notes: c.notes,
          closedBy: c.closed_by,
          closedByEmail: c.closed_by_email,
          closedAt: c.closed_at,
          reopenedAt: c.reopened_at,
          reopenedByEmail: c.reopened_by_email,
          reopenReason: c.reopen_reason,
        })),
      };
    });
  }

  private async preview(client: PoolClient, books: TenantBooks, through: string): Promise<ClosePreview & { endAt: Date; rows: AccountRow[] }> {
    assertRealDate(through, 'through');
    const locked = await this.repo.lockedThrough(client);
    const periodStart = locked ? addDays(locked, 1) : null;
    const blockers: string[] = [];
    if (through >= books.today) blockers.push(`Only a day that has ended can be closed — ${readableDate(through)} hasn't ended yet.`);
    if (locked && through <= locked) blockers.push(`The books are already closed through ${readableDate(locked)}.`);

    const { endAt } = await this.repo.instants(client, books.timezone, null, through);
    const { startAt } = periodStart
      ? await this.repo.instants(client, books.timezone, periodStart, through)
      : { startAt: null };
    const rows =
      blockers.length > 0
        ? []
        : (await this.repo.balances(client, startAt, endAt, true)).filter(
            (r) => (r.root_type === 'revenue' || r.root_type === 'expense') && !isZero(r.net),
          );
    const netIncome = sumMoney(rows.map((r) => subtractMoney('0', r.net)));

    const warnings: string[] = [];
    if (blockers.length === 0) {
      const w = await this.repo.closeWarnings(client, endAt);
      if (w.unreconciled_trips > 0) {
        warnings.push(`${w.unreconciled_trips} finished trip(s) haven't had their cash reconciled — shortages won't be in this period.`);
      }
      if (w.ungraded_lots > 0) {
        warnings.push(`${w.ungraded_lots} lot(s) received in this period are still ungraded — their cost isn't on the books yet.`);
      }
      if (w.pending_approvals > 0) warnings.push(`${w.pending_approvals} approval request(s) are still waiting on a decision.`);
    }
    return {
      currency: books.currency,
      periodStart,
      periodEnd: through,
      netIncome,
      lines: rows.map((r) => ({ code: r.code, number: r.number, name: r.name, rootType: r.root_type, amount: natural(r.net, r.root_type) })),
      blockers,
      warnings,
      endAt,
      rows,
    };
  }

  getClosePreview(tenantId: string, through: string): Promise<ClosePreview> {
    return this.db.withTenant(tenantId, async (client) => {
      const { endAt: _endAt, rows: _rows, ...preview } = await this.preview(client, await this.books(client), through);
      return preview;
    });
  }

  /**
   * Closes the books through a date: one entry moves the period's revenue
   * and expense balances to retained earnings, dated the last instant of
   * the period, and from then on the database refuses any posting dated
   * on or before it. Periods close in order — each starts the day after
   * the previous close.
   */
  closePeriod(tenantId: string, actorUserId: string, dto: ClosePeriodDto): Promise<PeriodsOverview> {
    return this.db
      .withTenant(tenantId, async (client) => {
        await this.repo.lockPeriods(client);
        const books = await this.books(client);
        const preview = await this.preview(client, books, dto.through);
        if (preview.blockers.length > 0) throw new ConflictException(preview.blockers.join(' '));

        const closeId = randomUUID();
        let closingEntryId: string | null = null;
        if (preview.rows.length > 0) {
          // Each P&L account is zeroed; retained earnings takes the net.
          const lines = preview.rows.map((r) =>
            compareMoney(r.net, '0') > 0
              ? { account: r.code, credit: r.net }
              : { account: r.code, debit: subtractMoney('0', r.net) },
          );
          if (compareMoney(preview.netIncome, '0') > 0) lines.push({ account: 'retained_earnings', credit: preview.netIncome });
          if (compareMoney(preview.netIncome, '0') < 0) {
            lines.push({ account: 'retained_earnings', debit: subtractMoney('0', preview.netIncome) });
          }
          closingEntryId = await this.ledger.postManualWithClient(client, {
            tenantId,
            entryType: 'period_close',
            sourceType: PERIOD_ENTITY,
            sourceId: closeId,
            occurredAt: new Date(preview.endAt.getTime() - 1),
            memo: `Period close ${preview.periodStart ?? 'from the start'} to ${preview.periodEnd}: profit to retained earnings`,
            createdBy: actorUserId,
            lines,
          });
        }
        await this.repo.insertClose(client, {
          id: closeId,
          tenantId,
          periodStart: preview.periodStart,
          periodEnd: preview.periodEnd,
          netIncome: preview.netIncome,
          closingEntryId,
          notes: dto.notes?.trim() || null,
          closedBy: actorUserId,
        });
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'create',
          entityType: PERIOD_ENTITY,
          entityId: closeId,
          after: { periodStart: preview.periodStart, periodEnd: preview.periodEnd, netIncome: preview.netIncome, closingEntryId },
        });
      })
      .then(() => this.getPeriods(tenantId));
  }

  /**
   * Reopens the most recent close: its closing entry is reversed (DE.4),
   * the close is marked reopened (it stays as history), and the lock falls
   * back to the close before it. Only the latest — reopening an earlier
   * period under a later closed one would change figures the later close
   * already carried forward.
   */
  reopenPeriod(tenantId: string, actorUserId: string, closeId: string, dto: ReopenPeriodDto): Promise<PeriodsOverview> {
    return this.db
      .withTenant(tenantId, async (client) => {
        await this.repo.lockPeriods(client);
        const books = await this.books(client);
        const close = await this.repo.findClose(client, closeId);
        if (!close) throw new NotFoundException('Period close not found');
        if (close.reopened_at) throw new ConflictException('This period has already been reopened');
        const locked = await this.repo.lockedThrough(client);
        if (locked !== close.period_end) throw new ConflictException('Only the most recent close can be reopened — reopen the later period first');

        let reopenEntryId: string | null = null;
        if (close.closing_entry_id) {
          const closing = await this.entryOrThrow(client, books.timezone, close.closing_entry_id);
          reopenEntryId = await this.ledger.postManualWithClient(client, {
            tenantId,
            entryType: 'period_reopen',
            sourceType: PERIOD_ENTITY,
            sourceId: closeId,
            reversesEntryId: closing.id,
            occurredAt: closing.occurredAt,
            memo: `Period reopened: ${dto.reason.trim()}`,
            createdBy: actorUserId,
            lines: closing.lines.map((l) => ({ account: l.accountCode, debit: l.credit, credit: l.debit })),
          });
        }
        await this.repo.markReopened(client, closeId, actorUserId, dto.reason.trim(), reopenEntryId);
        await this.audit.record(client, {
          tenantId,
          actorUserId,
          action: 'update',
          entityType: PERIOD_ENTITY,
          entityId: closeId,
          before: { reopened: false },
          after: { reopened: true, reason: dto.reason.trim(), reopenEntryId },
        });
      })
      .then(() => this.getPeriods(tenantId));
  }
}
