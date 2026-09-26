import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { FinanceService, PAYABLE_OVERDUE_DAYS } from './finance.service';
import { FinanceRepository, ReceivableRow, ResolvedRange } from './repositories/finance.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { sumMoney } from '../../common/money';

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
  delivered: '0.00',
  collected: '0.00',
  outstanding: '0.00',
  not_yet_due: '0.00',
  overdue_1_30: '0.00',
  overdue_31_60: '0.00',
  overdue_over_60: '0.00',
  open_order_value: '0.00',
  last_collection_at: null,
  ...over,
});

describe('FinanceService', () => {
  let service: FinanceService;
  let repo: jest.Mocked<FinanceRepository>;

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
            unsettledLotsForFarmer: jest.fn(),
            cashTotals: jest.fn(),
            cashByDay: jest.fn(),
            recentCashMovements: jest.fn(),
            tripsAwaitingReconciliation: jest.fn(),
            recentReconciliations: jest.fn(),
          },
        },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
      ],
    }).compile();

    service = module.get(FinanceService);
    repo = module.get(FinanceRepository);
  });

  it('getReceivables totals every aging bucket past due as overdue', async () => {
    repo.receivables.mockResolvedValue([
      receivable('a', { outstanding: '1500.50', not_yet_due: '1000.00', overdue_1_30: '500.50' }),
      receivable('b', { outstanding: '900.00', overdue_31_60: '400.00', overdue_over_60: '500.00' }),
    ]);

    const report = await service.getReceivables('tenant-1');

    expect(report.currency).toBe('INR');
    expect(report.totals).toEqual({ outstanding: '2400.50', notYetDue: '1000.00', overdue: '1400.50' });
    expect(report.customers[0]).toMatchObject({ customerId: 'a', overdue1To30: '500.50', paymentTermsDays: 7 });
  });

  it('getPayables asks for overdue with the same window as the dashboard alert', async () => {
    repo.payables.mockResolvedValue([
      {
        farmer_id: 'f1',
        farmer_name: 'Ravi',
        owed: '3000.00',
        overdue: '1000.00',
        unsettled_lots: 2,
        oldest_unsettled_graded_at: new Date('2026-09-01T00:00:00Z'),
        last_settled_at: null,
      },
    ]);

    const report = await service.getPayables('tenant-1');

    expect(repo.payables).toHaveBeenCalledWith(fakeClient, PAYABLE_OVERDUE_DAYS);
    expect(report.overdueAfterDays).toBe(PAYABLE_OVERDUE_DAYS);
    expect(report.totals).toEqual({ owed: '3000.00', overdue: '1000.00' });
  });

  it('getCashFlow queries the resolved tenant-local range', async () => {
    repo.cashTotals.mockResolvedValue({
      cash_in: '5000.00',
      settlements_out: '3000.00',
      expenses_out: '250.00',
      net: '1750.00',
    });
    repo.cashByDay.mockResolvedValue([{ date: '2026-09-01', cash_in: '5000.00', cash_out: '3250.00' }]);
    repo.recentCashMovements.mockResolvedValue([]);

    const report = await service.getCashFlow('tenant-1', { days: 30 });

    expect(repo.resolveRange).toHaveBeenCalledWith(fakeClient, null, null, 30);
    expect(repo.cashByDay).toHaveBeenCalledWith(
      fakeClient,
      'Asia/Kolkata',
      '2026-09-01',
      '2026-09-30',
      range.startAt,
      range.endAt,
    );
    expect(report.totals.net).toBe('1750.00');
    expect(report.daily).toEqual([{ date: '2026-09-01', cashIn: '5000.00', cashOut: '3250.00' }]);
  });

  it('getCashFlow rejects a calendar date that does not exist', async () => {
    await expect(service.getCashFlow('tenant-1', { from: '2026-02-31' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getCashFlow rejects from after to', async () => {
    repo.resolveRange.mockResolvedValueOnce({ ...range, fromDate: '2026-09-10', toDate: '2026-09-01' });
    await expect(service.getCashFlow('tenant-1', { from: '2026-09-10', to: '2026-09-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound when the tenant row is missing', async () => {
    repo.tenantContext.mockResolvedValueOnce(null);
    await expect(service.getTripCash('tenant-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('sumMoney', () => {
  it.each([
    [[], '0.00'],
    [['0.10', '0.20'], '0.30'],
    [['100.5', '-0.75'], '99.75'],
    [['-1.00', '-2.50'], '-3.50'],
  ])('sums %j to %s exactly', (values, expected) => {
    expect(sumMoney(values)).toBe(expected);
  });
});
