import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { FinanceService, PAYABLE_OVERDUE_DAYS } from './finance.service';
import { FinanceRepository, ReceivableRow, ResolvedRange, TrialBalanceRowDb } from './repositories/finance.repository';
import { ReceivablesService } from './receivables.service';
import { CustomersService } from '../customers/customers.service';
import { DatabaseService } from '../../infra/database/database.service';

const fakeClient = {} as PoolClient;

const range: ResolvedRange = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  fromDate: '2026-09-01',
  toDate: '2026-09-30',
  startAt: new Date('2026-08-31T18:30:00Z'),
  endAt: new Date('2026-09-30T18:30:00Z'),
};

const receivable = (id: string, over: Partial<ReceivableRow>): ReceivableRow => ({
  customer_id: id,
  customer_name: `Customer ${id}`,
  credit_limit: '50000.00',
  payment_terms_days: 7,
  credit_hold: false,
  invoiced: '0.00',
  collected: '0.00',
  outstanding: '0.00',
  credit_on_account: '0.00',
  not_yet_due: '0.00',
  overdue_1_30: '0.00',
  overdue_31_60: '0.00',
  overdue_over_60: '0.00',
  open_order_value: '0.00',
  last_collection_at: null,
  ...over,
});

const account = (code: string, root: TrialBalanceRowDb['root_type'], debit: string, credit: string, balance: string) => ({
  account: code,
  name: code,
  root_type: root,
  debit,
  credit,
  balance,
});

describe('FinanceService', () => {
  let service: FinanceService;
  let repo: jest.Mocked<FinanceRepository>;
  let receivables: jest.Mocked<ReceivablesService>;
  let customers: jest.Mocked<CustomersService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        {
          provide: FinanceRepository,
          useValue: {
            tenantContext: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata', currency: 'INR' }),
            resolveRange: jest.fn().mockResolvedValue(range),
            receivables: jest.fn(),
            payables: jest.fn(),
            payableLotsForFarmer: jest.fn(),
            cashTotals: jest.fn(),
            cashByDay: jest.fn(),
            recentCashMovements: jest.fn(),
            tripsAwaitingReconciliation: jest.fn(),
            recentReconciliations: jest.fn(),
            openOrderValue: jest.fn(),
            statement: jest.fn(),
            trialBalance: jest.fn(),
            subledgerTotals: jest.fn(),
          },
        },
        { provide: ReceivablesService, useValue: { customerBalanceWithClient: jest.fn() } },
        { provide: CustomersService, useValue: { getById: jest.fn() } },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
      ],
    }).compile();

    service = module.get(FinanceService);
    repo = module.get(FinanceRepository);
    receivables = module.get(ReceivablesService);
    customers = module.get(CustomersService);
  });

  it('getReceivables totals every aging bucket past due as overdue, and credit on account separately', async () => {
    repo.receivables.mockResolvedValue([
      receivable('a', { outstanding: '1500.50', not_yet_due: '1000.00', overdue_1_30: '500.50', credit_on_account: '25.00' }),
      receivable('b', { outstanding: '900.00', overdue_31_60: '400.00', overdue_over_60: '500.00' }),
    ]);

    const report = await service.getReceivables('tenant-1');

    expect(report.totals).toEqual({
      outstanding: '2400.50',
      notYetDue: '1000.00',
      overdue: '1400.50',
      creditOnAccount: '25.00',
    });
    expect(report.customers[0]).toMatchObject({ customerId: 'a', overdue1To30: '500.50', paymentTermsDays: 7, creditHold: false });
  });

  it('getPayables asks for overdue with the same window as the dashboard alert and totals advances', async () => {
    repo.payables.mockResolvedValue([
      {
        farmer_id: 'f1',
        farmer_name: 'Ravi',
        owed: '3000.00',
        overdue: '1000.00',
        unpaid_lots: 2,
        oldest_unpaid_accrued_at: new Date('2026-09-01T00:00:00Z'),
        advance: '0.00',
        last_paid_at: null,
      },
      {
        farmer_id: 'f2',
        farmer_name: 'Lakshmi',
        owed: '0.00',
        overdue: '0.00',
        unpaid_lots: 0,
        oldest_unpaid_accrued_at: null,
        advance: '750.00',
        last_paid_at: new Date(),
      },
    ]);

    const report = await service.getPayables('tenant-1');

    expect(repo.payables).toHaveBeenCalledWith(fakeClient, PAYABLE_OVERDUE_DAYS);
    expect(report.totals).toEqual({ owed: '3000.00', overdue: '1000.00', advances: '750.00' });
  });

  it('getCashFlow queries the resolved tenant-local range', async () => {
    repo.cashTotals.mockResolvedValue({
      cash_in: '5000.00',
      farmer_payments_out: '3000.00',
      expenses_out: '250.00',
      finance_costs_out: '15.00',
      net: '1735.00',
    });
    repo.cashByDay.mockResolvedValue([{ date: '2026-09-01', cash_in: '5000.00', cash_out: '3265.00' }]);
    repo.recentCashMovements.mockResolvedValue([]);

    const report = await service.getCashFlow('tenant-1', { days: 30 });

    expect(repo.resolveRange).toHaveBeenCalledWith(fakeClient, null, null, 30);
    expect(report.totals).toEqual({
      cashIn: '5000.00',
      farmerPaymentsOut: '3000.00',
      expensesOut: '250.00',
      financeCostsOut: '15.00',
      net: '1735.00',
    });
    expect(report.daily).toEqual([{ date: '2026-09-01', cashIn: '5000.00', cashOut: '3265.00' }]);
  });

  it('getCashFlow rejects a calendar date that does not exist', async () => {
    await expect(service.getCashFlow('tenant-1', { from: '2026-02-31' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getCreditStatus: exposure = balance owed + open orders; available can go negative', async () => {
    customers.getById.mockResolvedValue({
      id: 'c1',
      name: 'Anand Caterers',
      creditLimit: '5000.00',
      paymentTermsDays: 7,
      financeChargeRateMonthly: '1.50',
      financeChargeGraceDays: 3,
      creditHold: false,
      creditHoldReason: null,
    } as never);
    receivables.customerBalanceWithClient.mockResolvedValue({
      invoicedOutstanding: '2200.00',
      unappliedCredit: '200.00',
      balance: '2000.00',
      overdue: '1200.00',
      oldestOverdueDays: 12,
    });
    repo.openOrderValue.mockResolvedValue('6820.00');

    const status = await service.getCreditStatus('tenant-1', 'c1');

    expect(status).toMatchObject({ balance: '2000.00', openOrderValue: '6820.00', exposure: '8820.00', available: '-3820.00' });
  });

  it('getTrialBalance reports balanced books and control accounts agreeing with sub-ledgers', async () => {
    repo.trialBalance.mockResolvedValue([
      account('bank', 'asset', '987.50', '3005.00', '-2017.50'),
      account('accounts_receivable', 'asset', '2800.00', '1000.00', '1800.00'),
      account('farmer_advance', 'asset', '500.00', '0.00', '500.00'),
      account('inventory_asset', 'asset', '1900.00', '0.00', '1900.00'),
      account('accounts_payable_farmer', 'liability', '1900.00', '1900.00', '0.00'),
      account('revenue_sales', 'revenue', '0.00', '2800.00', '-2800.00'),
      account('finance_costs', 'expense', '17.50', '0.00', '17.50'),
    ]);
    repo.subledgerTotals.mockResolvedValue({ receivable: '1800.00', payable: '0.00', advances: '500.00' });

    const tb = await service.getTrialBalance('tenant-1');

    expect(tb.totals).toEqual({ debit: '8105.00', credit: '8705.00' });
    expect(tb.balanced).toBe(false); // these sample figures deliberately don't balance
    expect(tb.checks).toEqual([
      { name: 'Accounts receivable', ledger: '1800.00', subledger: '1800.00', agrees: true },
      { name: 'Accounts payable — farmers', ledger: '0.00', subledger: '0.00', agrees: true },
      { name: 'Farmer advances', ledger: '500.00', subledger: '500.00', agrees: true },
    ]);
  });

  it('getTrialBalance flags a control account out of step with its sub-ledger', async () => {
    repo.trialBalance.mockResolvedValue([
      account('accounts_payable_farmer', 'liability', '0.00', '1900.00', '-1900.00'),
      account('inventory_asset', 'asset', '1900.00', '0.00', '1900.00'),
    ]);
    repo.subledgerTotals.mockResolvedValue({ receivable: '0.00', payable: '1850.00', advances: '0.00' });

    const tb = await service.getTrialBalance('tenant-1');

    expect(tb.balanced).toBe(true);
    expect(tb.checks[1]).toEqual({ name: 'Accounts payable — farmers', ledger: '1900.00', subledger: '1850.00', agrees: false });
  });

  it('throws NotFound when the tenant row is missing', async () => {
    repo.tenantContext.mockResolvedValueOnce(null);
    await expect(service.getTripCash('tenant-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
