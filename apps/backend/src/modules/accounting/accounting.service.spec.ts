import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AccountingService } from './accounting.service';
import { AccountingRepository, AccountRow, EntryRow, LineRow } from './repositories/accounting.repository';
import { LedgerService } from '../finance/ledger.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ReportGroup, RootType } from './entities/accounting.entity';

const fakeClient = {} as PoolClient;
const books = { timezone: 'Asia/Kolkata', currency: 'INR', today: '2026-09-27' };
const startAt = new Date('2026-08-31T18:30:00Z');
const endAt = new Date('2026-09-27T18:30:00Z');

let numberSeq = 1;
const account = (code: string, root: RootType, group: ReportGroup, net = '0.00', extra: Partial<AccountRow> = {}): AccountRow => ({
  id: `id-${code}`,
  code,
  number: numberSeq++,
  name: code,
  root_type: root,
  report_group: group,
  is_system: true,
  is_control: false,
  is_active: true,
  description: null,
  version: 1,
  net,
  ...extra,
});

const entryRow = (over: Partial<EntryRow> = {}): EntryRow => ({
  id: 'entry-1',
  entry_type: 'manual_journal',
  source_type: 'manual_journal',
  source_id: 'journal-1',
  occurred_at: new Date('2026-09-10T06:30:00Z'),
  date: '2026-09-10',
  memo: 'Rent for September',
  reverses_entry_id: null,
  reversed_by_entry_id: null,
  created_by: 'user-1',
  created_by_email: 'owner@x.test',
  created_at: new Date(),
  journal_number: 7,
  reference: null,
  total: '15000.00',
  ...over,
});

const line = (account_code: string, debit: string, credit: string): LineRow => ({
  entry_id: 'entry-1',
  account_code,
  account_number: 1,
  account_name: account_code,
  party_type: null,
  party_id: null,
  party_name: null,
  debit,
  credit,
});

describe('AccountingService', () => {
  let service: AccountingService;
  let repo: jest.Mocked<AccountingRepository>;
  let ledger: jest.Mocked<LedgerService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AccountingService,
        {
          provide: AccountingRepository,
          useValue: {
            books: jest.fn().mockResolvedValue(books),
            instants: jest.fn().mockResolvedValue({ startAt, endAt }),
            listAccounts: jest.fn(),
            findAccount: jest.fn(),
            findAccounts: jest.fn(),
            accountNumberTaken: jest.fn().mockResolvedValue(false),
            codesLike: jest.fn().mockResolvedValue([]),
            insertAccount: jest.fn(),
            updateAccount: jest.fn().mockResolvedValue(true),
            nextJournalNumber: jest.fn().mockResolvedValue(8),
            insertManualJournal: jest.fn(),
            journalInstant: jest.fn().mockResolvedValue(new Date('2026-09-20T06:30:00Z')),
            listEntries: jest.fn(),
            findEntry: jest.fn().mockResolvedValue(entryRow()),
            linesFor: jest.fn().mockResolvedValue([]),
            accountMovement: jest.fn(),
            accountLines: jest.fn(),
            balances: jest.fn(),
            cashCounterparts: jest.fn(),
            lockedThrough: jest.fn().mockResolvedValue(null),
            listCloses: jest.fn().mockResolvedValue([]),
            findClose: jest.fn(),
            lockPeriods: jest.fn(),
            insertClose: jest.fn(),
            markReopened: jest.fn(),
            closeWarnings: jest.fn().mockResolvedValue({ unreconciled_trips: 0, ungraded_lots: 0, pending_approvals: 0 }),
          },
        },
        { provide: LedgerService, useValue: { postManualWithClient: jest.fn().mockResolvedValue('entry-new') } },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(AccountingService);
    repo = module.get(AccountingRepository);
    ledger = module.get(LedgerService);
  });

  // ---- Journals ----

  describe('createJournal', () => {
    const rentJournal = {
      date: '2026-09-20',
      memo: 'Rent for September',
      lines: [
        { accountCode: 'rent', debit: 15000 },
        { accountCode: 'bank', credit: 15000 },
      ],
    };

    beforeEach(() => {
      repo.findAccounts.mockResolvedValue([
        account('rent', 'expense', 'operating_expense', '0.00', { is_system: false }),
        account('bank', 'asset', 'cash'),
      ]);
    });

    it('posts a balanced journal against the new header, numbered in sequence', async () => {
      await service.createJournal('tenant-1', 'user-1', rentJournal);

      const header = repo.insertManualJournal.mock.calls[0][1];
      expect(header).toMatchObject({ journalNumber: 8, entryDate: '2026-09-20', memo: 'Rent for September' });
      expect(ledger.postManualWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({
          entryType: 'manual_journal',
          sourceId: header.id,
          lines: [
            { account: 'rent', debit: '15000.00', credit: '0.00' },
            { account: 'bank', debit: '0.00', credit: '15000.00' },
          ],
        }),
      );
    });

    it('refuses one that does not balance', async () => {
      await expect(
        service.createJournal('tenant-1', 'user-1', {
          ...rentJournal,
          lines: [
            { accountCode: 'rent', debit: 15000 },
            { accountCode: 'bank', credit: 14000 },
          ],
        }),
      ).rejects.toThrow(/must be equal/);
      expect(ledger.postManualWithClient).not.toHaveBeenCalled();
    });

    it('refuses a line with both or neither side', async () => {
      await expect(
        service.createJournal('tenant-1', 'user-1', {
          ...rentJournal,
          lines: [
            { accountCode: 'rent', debit: 100, credit: 100 },
            { accountCode: 'bank', credit: 0 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a control account — its sub-ledger would stop agreeing', async () => {
      repo.findAccounts.mockResolvedValue([
        account('accounts_receivable', 'asset', 'current_asset', '0.00', { is_control: true }),
        account('bank', 'asset', 'cash'),
      ]);
      await expect(
        service.createJournal('tenant-1', 'user-1', {
          ...rentJournal,
          lines: [
            { accountCode: 'accounts_receivable', debit: 500 },
            { accountCode: 'bank', credit: 500 },
          ],
        }),
      ).rejects.toThrow(/control account/);
    });

    it('refuses a retired account and one the tenant does not have', async () => {
      repo.findAccounts.mockResolvedValue([account('bank', 'asset', 'cash')]);
      await expect(service.createJournal('tenant-1', 'user-1', rentJournal)).rejects.toThrow(/no account rent/);

      repo.findAccounts.mockResolvedValue([
        account('rent', 'expense', 'operating_expense', '0.00', { is_active: false }),
        account('bank', 'asset', 'cash'),
      ]);
      await expect(service.createJournal('tenant-1', 'user-1', rentJournal)).rejects.toThrow(/retired/);
    });

    it('refuses a date in a closed period, and one in the future', async () => {
      repo.lockedThrough.mockResolvedValue('2026-09-30');
      await expect(service.createJournal('tenant-1', 'user-1', rentJournal)).rejects.toBeInstanceOf(ConflictException);

      repo.lockedThrough.mockResolvedValue(null);
      await expect(
        service.createJournal('tenant-1', 'user-1', { ...rentJournal, date: '2026-09-28' }),
      ).rejects.toThrow(/future/);
    });
  });

  describe('reverseJournal', () => {
    it('posts every line on the other side, linked to the original', async () => {
      repo.linesFor.mockResolvedValue([line('rent', '15000.00', '0.00'), line('bank', '0.00', '15000.00')]);

      await service.reverseJournal('tenant-1', 'user-1', 'entry-1', { date: '2026-09-25' });

      expect(ledger.postManualWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({
          entryType: 'journal_reversal',
          reversesEntryId: 'entry-1',
          sourceId: 'entry-1',
          lines: [
            { account: 'rent', debit: '0.00', credit: '15000.00' },
            { account: 'bank', debit: '15000.00', credit: '0.00' },
          ],
        }),
      );
    });

    it('refuses anything but a manual journal, and one already reversed', async () => {
      repo.findEntry.mockResolvedValueOnce(entryRow({ entry_type: 'invoice_issued' }));
      await expect(service.reverseJournal('tenant-1', 'user-1', 'entry-1', {})).rejects.toThrow(/Only manual journals/);

      repo.findEntry.mockResolvedValueOnce(entryRow({ reversed_by_entry_id: 'entry-9' }));
      await expect(service.reverseJournal('tenant-1', 'user-1', 'entry-1', {})).rejects.toThrow(/already been reversed/);
    });

    it('refuses a reversal dated before the journal', async () => {
      await expect(service.reverseJournal('tenant-1', 'user-1', 'entry-1', { date: '2026-09-01' })).rejects.toThrow(/on or after/);
    });
  });

  // ---- Statements ----

  const trading = () => [
    account('bank', 'asset', 'cash', '1305.00'),
    account('accounts_receivable', 'asset', 'current_asset', '400.00'),
    account('inventory_asset', 'asset', 'current_asset', '200.00'),
    account('accounts_payable_farmer', 'liability', 'current_liability', '-300.00'),
    account('owner_capital', 'equity', 'equity', '-1300.00'),
    account('retained_earnings', 'equity', 'equity', '0.00'),
    account('revenue_sales', 'revenue', 'sales', '-1000.00'),
    account('sales_returns', 'revenue', 'contra_sales', '50.00'),
    account('finance_charge_income', 'revenue', 'other_income', '-10.00'),
    account('cost_of_goods_sold', 'expense', 'cost_of_sales', '600.00'),
    account('shrinkage_expense', 'expense', 'operating_expense', '20.00'),
    account('trip_expense_fuel', 'expense', 'operating_expense', '30.00'),
    account('finance_costs', 'expense', 'finance_cost', '5.00'),
  ];

  it('getProfitAndLoss: returns reduce sales; shrinkage stays out of gross margin', async () => {
    repo.balances.mockResolvedValue(trading());

    const pnl = await service.getProfitAndLoss('tenant-1', {});

    expect(repo.balances).toHaveBeenCalledWith(fakeClient, startAt, endAt, true); // closing entries excluded
    expect(pnl.from).toBe('2026-09-01'); // month to date by default
    expect(pnl.figures).toEqual({
      netSales: '950.00',
      costOfSales: '600.00',
      grossProfit: '350.00',
      operatingExpenses: '50.00',
      operatingProfit: '300.00',
      otherIncome: '10.00',
      financeCosts: '5.00',
      otherExpenses: '0.00',
      netProfit: '305.00',
    });
    expect(pnl.sections.find((s) => s.key === 'contra_sales')?.total).toBe('-50.00');
    expect(pnl.previous).toMatchObject({ from: '2026-08-05', to: '2026-08-31' });
  });

  it('getBalanceSheet balances, counting profit not yet closed as equity', async () => {
    repo.balances.mockResolvedValue(trading());

    const sheet = await service.getBalanceSheet('tenant-1');

    expect(sheet.assets.total).toBe('1905.00');
    expect(sheet.liabilities.total).toBe('300.00');
    expect(sheet.equity.unclosedProfit).toBe('305.00');
    expect(sheet.equity.total).toBe('1605.00');
    expect(sheet.balanced).toBe(true);
  });

  it('getTrialBalance puts each non-zero balance on its own side', async () => {
    repo.balances.mockResolvedValue(trading());

    const tb = await service.getTrialBalance('tenant-1', '2026-09-27');

    expect(tb.totals).toEqual({ debit: '2610.00', credit: '2610.00' });
    expect(tb.balanced).toBe(true);
    expect(tb.lines.find((l) => l.code === 'retained_earnings')).toBeUndefined();
    expect(tb.lines.find((l) => l.code === 'accounts_payable_farmer')).toMatchObject({ debit: '0.00', credit: '300.00' });
  });

  it('getCashFlowStatement sorts cash movements into operating, investing, and financing', async () => {
    repo.balances
      .mockResolvedValueOnce([account('bank', 'asset', 'cash', '100.00'), account('cash_on_hand', 'asset', 'cash', '50.00')])
      .mockResolvedValueOnce([account('bank', 'asset', 'cash', '2100.00'), account('cash_on_hand', 'asset', 'cash', '50.00')]);
    repo.cashCounterparts.mockResolvedValue([
      { code: 'accounts_receivable', number: 1100, name: 'Accounts receivable', report_group: 'current_asset', amount: '1000.00' },
      { code: 'fixed_assets_vehicles', number: 1500, name: 'Vehicles', report_group: 'fixed_asset', amount: '-500.00' },
      { code: 'owner_capital', number: 3000, name: "Owner's capital", report_group: 'equity', amount: '1500.00' },
    ]);

    const cash = await service.getCashFlowStatement('tenant-1', {});

    expect(cash.openingCash).toBe('150.00');
    expect(cash.closingCash).toBe('2150.00');
    expect(cash.netChange).toBe('2000.00');
    expect(cash.activities.map((a) => [a.activity, a.total])).toEqual([
      ['operating', '1000.00'],
      ['investing', '-500.00'],
      ['financing', '1500.00'],
    ]);
    expect(cash.activities[0].lines[0].label).toBe('Collected from customers');
  });

  // ---- Periods ----

  describe('closePeriod', () => {
    it('zeroes every P&L balance of the period into retained earnings', async () => {
      repo.balances.mockResolvedValue(trading());

      await service.closePeriod('tenant-1', 'user-1', { through: '2026-09-26' });

      const posting = ledger.postManualWithClient.mock.calls[0][1];
      expect(posting.entryType).toBe('period_close');
      expect(posting.occurredAt.getTime()).toBe(endAt.getTime() - 1); // the period's last instant
      expect(posting.lines).toEqual([
        { account: 'revenue_sales', debit: '1000.00' },
        { account: 'sales_returns', credit: '50.00' },
        { account: 'finance_charge_income', debit: '10.00' },
        { account: 'cost_of_goods_sold', credit: '600.00' },
        { account: 'shrinkage_expense', credit: '20.00' },
        { account: 'trip_expense_fuel', credit: '30.00' },
        { account: 'finance_costs', credit: '5.00' },
        { account: 'retained_earnings', credit: '305.00' },
      ]);
      expect(repo.insertClose).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ periodStart: null, periodEnd: '2026-09-26', netIncome: '305.00', closingEntryId: 'entry-new' }),
      );
    });

    it('a loss is debited to retained earnings, and the next period starts the day after the last close', async () => {
      repo.lockedThrough.mockResolvedValue('2026-08-31');
      repo.balances.mockResolvedValue([
        account('revenue_sales', 'revenue', 'sales', '-100.00'),
        account('rent', 'expense', 'operating_expense', '400.00'),
      ]);

      await service.closePeriod('tenant-1', 'user-1', { through: '2026-09-26' });

      expect(ledger.postManualWithClient.mock.calls[0][1].lines).toContainEqual({ account: 'retained_earnings', debit: '300.00' });
      expect(repo.insertClose).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ periodStart: '2026-09-01', netIncome: '-300.00' }),
      );
    });

    it('refuses a day that has not ended, or one already closed', async () => {
      await expect(service.closePeriod('tenant-1', 'user-1', { through: '2026-09-27' })).rejects.toThrow(/hasn't ended/);
      repo.lockedThrough.mockResolvedValue('2026-09-26');
      await expect(service.closePeriod('tenant-1', 'user-1', { through: '2026-09-20' })).rejects.toThrow(/already closed/);
      expect(ledger.postManualWithClient).not.toHaveBeenCalled();
    });

    it('records a close with no entry when nothing happened in the period', async () => {
      repo.balances.mockResolvedValue([account('rent', 'expense', 'operating_expense', '0.00')]);

      await service.closePeriod('tenant-1', 'user-1', { through: '2026-09-26' });

      expect(ledger.postManualWithClient).not.toHaveBeenCalled();
      expect(repo.insertClose).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ closingEntryId: null, netIncome: '0.00' }));
    });
  });

  describe('reopenPeriod', () => {
    it('reverses the closing entry and marks the close reopened', async () => {
      repo.findClose.mockResolvedValue({ id: 'close-1', period_end: '2026-09-26', closing_entry_id: 'entry-1', reopened_at: null });
      repo.lockedThrough.mockResolvedValue('2026-09-26');
      repo.findEntry.mockResolvedValue(entryRow({ entry_type: 'period_close' }));
      repo.linesFor.mockResolvedValue([line('revenue_sales', '1000.00', '0.00'), line('retained_earnings', '0.00', '1000.00')]);

      await service.reopenPeriod('tenant-1', 'user-1', '00000000-0000-0000-0000-000000000001', { reason: 'Missed a bill' });

      expect(ledger.postManualWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({
          entryType: 'period_reopen',
          reversesEntryId: 'entry-1',
          lines: [
            { account: 'revenue_sales', debit: '0.00', credit: '1000.00' },
            { account: 'retained_earnings', debit: '1000.00', credit: '0.00' },
          ],
        }),
      );
      expect(repo.markReopened).toHaveBeenCalledWith(fakeClient, '00000000-0000-0000-0000-000000000001', 'user-1', 'Missed a bill', 'entry-new');
    });

    it('only the most recent close can be reopened', async () => {
      repo.findClose.mockResolvedValue({ id: 'close-1', period_end: '2026-08-31', closing_entry_id: null, reopened_at: null });
      repo.lockedThrough.mockResolvedValue('2026-09-26');
      await expect(service.reopenPeriod('tenant-1', 'user-1', 'close-1', { reason: 'x y z' })).rejects.toThrow(/most recent/);
    });
  });

  // ---- Chart of accounts ----

  describe('accounts', () => {
    it('derives a unique code from the name', async () => {
      repo.codesLike.mockResolvedValue(['cold_storage']);
      repo.findAccount.mockResolvedValue(account('cold_storage_2', 'expense', 'operating_expense'));

      await service.createAccount('tenant-1', 'user-1', {
        number: 6810,
        name: 'Cold storage',
        rootType: 'expense',
        reportGroup: 'operating_expense',
      });

      expect(repo.insertAccount).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', expect.objectContaining({ code: 'cold_storage_2' }));
    });

    it('refuses a group that does not belong under the root type', async () => {
      await expect(
        service.createAccount('tenant-1', 'user-1', { number: 1, name: 'Odd', rootType: 'expense', reportGroup: 'sales' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never retires a system account, nor one with a balance', async () => {
      repo.findAccount.mockResolvedValueOnce(account('bank', 'asset', 'cash'));
      await expect(service.updateAccount('tenant-1', 'user-1', 'bank', { version: 1, isActive: false })).rejects.toThrow(/used by the system/);

      repo.findAccount.mockResolvedValueOnce(account('rent', 'expense', 'operating_expense', '100.00', { is_system: false }));
      await expect(service.updateAccount('tenant-1', 'user-1', 'rent', { version: 1, isActive: false })).rejects.toThrow(/still has a balance/);
    });
  });
});
