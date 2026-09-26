import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ALERT_THRESHOLDS, DashboardService, subtractMoney } from './dashboard.service';
import { AlertRow, DashboardRepository, PeriodFlows, ResolvedPeriod } from './repositories/dashboard.repository';
import { DatabaseService } from '../../infra/database/database.service';

const fakeClient = {} as PoolClient;

const period: ResolvedPeriod = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  fromDate: '2026-09-01',
  toDate: '2026-09-30',
  previousFrom: '2026-08-02',
  previousTo: '2026-08-31',
  startAt: new Date('2026-08-31T18:30:00Z'),
  endAt: new Date('2026-09-30T18:30:00Z'),
  previousStartAt: new Date('2026-08-01T18:30:00Z'),
};

const flows = (revenue: string): PeriodFlows => ({
  delivered_revenue: revenue,
  deliveries_completed: 4,
  orders_booked: 6,
  booked_order_value: '9000.00',
  procurement_spend: '5000.00',
  collections: '3000.00',
  farmer_settlements: '2000.00',
  trip_expenses: '400.00',
});

const noAlerts: AlertRow = {
  approvals_pending: 0,
  ungraded_count: 0,
  aging_count: 0,
  aging_value: '0.00',
  unreconciled_count: 0,
  variance_count: 0,
  variance_amount: '0.00',
  overdue_count: 0,
  overdue_value: '0.00',
  credit_breach_count: 0,
  credit_breach_amount: '0.00',
};

describe('DashboardService', () => {
  let service: DashboardService;
  let repo: jest.Mocked<DashboardRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: DashboardRepository,
          useValue: {
            resolvePeriod: jest.fn().mockResolvedValue(period),
            periodFlows: jest.fn(),
            balances: jest.fn(),
            profitTotals: jest.fn(),
            profitByProduct: jest.fn(),
            alerts: jest.fn(),
            operations: jest.fn(),
          },
        },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
      ],
    }).compile();

    service = module.get(DashboardService);
    repo = module.get(DashboardRepository);
  });

  it('getKpis compares the period against the same-length window immediately before it', async () => {
    repo.periodFlows.mockResolvedValueOnce(flows('12000.00')).mockResolvedValueOnce(flows('10000.00'));
    repo.balances.mockResolvedValue({
      stock_on_hand_value: '7000.00',
      receivables_outstanding: '4500.00',
      farmer_payables_outstanding: '1500.00',
    });

    const kpis = await service.getKpis('tenant-1', {});

    expect(repo.periodFlows).toHaveBeenNthCalledWith(1, fakeClient, period.startAt, period.endAt);
    expect(repo.periodFlows).toHaveBeenNthCalledWith(2, fakeClient, period.previousStartAt, period.startAt);
    expect(kpis.deliveredRevenue).toEqual({ kind: 'money', value: '12000.00', previous: '10000.00' });
    expect(kpis.deliveriesCompleted).toEqual({ kind: 'count', value: '4', previous: '4' });
    expect(kpis.stockOnHandValue.previous).toBeNull();
    expect(kpis.period.currency).toBe('INR');
  });

  it('defaults to a 30-day window when no dates are given', async () => {
    repo.periodFlows.mockResolvedValue(flows('0.00'));
    repo.balances.mockResolvedValue({
      stock_on_hand_value: '0.00',
      receivables_outstanding: '0.00',
      farmer_payables_outstanding: '0.00',
    });

    await service.getKpis('tenant-1', {});

    expect(repo.resolvePeriod).toHaveBeenCalledWith(fakeClient, null, null, 30);
  });

  it('passes a requested window length through so the backend resolves it in tenant-local time', async () => {
    repo.periodFlows.mockResolvedValue(flows('0.00'));
    repo.balances.mockResolvedValue({
      stock_on_hand_value: '0.00',
      receivables_outstanding: '0.00',
      farmer_payables_outstanding: '0.00',
    });

    await service.getKpis('tenant-1', { days: 7 });

    expect(repo.resolvePeriod).toHaveBeenCalledWith(fakeClient, null, null, 7);
  });

  it('rejects a date the format check allows but the calendar does not', async () => {
    await expect(service.getKpis('tenant-1', { from: '2026-02-31' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.resolvePeriod).not.toHaveBeenCalled();
  });

  it('rejects a period where from is after to', async () => {
    repo.resolvePeriod.mockResolvedValue({ ...period, fromDate: '2026-10-05', toDate: '2026-10-01' });

    await expect(service.getKpis('tenant-1', { from: '2026-10-05', to: '2026-10-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a period longer than a year', async () => {
    repo.resolvePeriod.mockResolvedValue({ ...period, fromDate: '2024-01-01', toDate: '2026-01-01' });

    await expect(service.getKpis('tenant-1', { from: '2024-01-01', to: '2026-01-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getProfit reports revenue with no costed lot separately instead of treating it as free', async () => {
    repo.profitTotals.mockResolvedValue({
      revenue: '10000.00',
      costed_revenue: '8000.00',
      cost_of_goods: '6000.00',
      gross_profit: '2000.00',
      gross_margin_percent: '25.0',
      trip_expenses: '500.00',
      operating_contribution: '1500.00',
    });
    repo.profitByProduct.mockResolvedValue([]);

    const profit = await service.getProfit('tenant-1', {});

    expect(profit.uncostedRevenue).toBe('2000.00');
    expect(profit.grossMarginPercent).toBe('25.0');
    expect(profit.operatingContribution).toBe('1500.00');
  });

  it('getAlerts drops zero-count alerts and puts critical ones first', async () => {
    repo.alerts.mockResolvedValue({
      ...noAlerts,
      approvals_pending: 3,
      aging_count: 2,
      aging_value: '1800.00',
      variance_count: 1,
      variance_amount: '250.00',
    });

    const result = await service.getAlerts('tenant-1');

    expect(repo.alerts).toHaveBeenCalledWith(fakeClient, ALERT_THRESHOLDS);
    expect(result.alerts.map((a) => a.code)).toEqual(['cash_variance', 'approvals_pending', 'aging_stock']);
    expect(result.alerts[0]).toEqual({ code: 'cash_variance', severity: 'critical', count: 1, amount: '250.00' });
    expect(result.currency).toBe('INR');
  });

  it('getAlerts returns an empty list when nothing needs attention', async () => {
    repo.alerts.mockResolvedValue(noAlerts);

    const result = await service.getAlerts('tenant-1');

    expect(result.alerts).toEqual([]);
  });

  it('getOperations uses a one-day window for "today"', async () => {
    repo.operations.mockResolvedValue({
      trips_planned: 1,
      trips_in_progress: 2,
      trips_completed_today: 3,
      trips_awaiting_reconciliation: 1,
      stops_pending: 5,
      stops_completed_today: 9,
      stops_skipped_today: 1,
      orders_awaiting_confirmation: 2,
      orders_awaiting_approval: 1,
      orders_awaiting_delivery: 4,
      orders_delivered_today: 7,
      pos_placed: 1,
      pos_awaiting_receipt: 2,
      pos_awaiting_grading: 1,
      pickups_scheduled_today: 3,
      lots_available: 12,
      lots_reserved: 4,
      lots_ungraded: 2,
    });

    const ops = await service.getOperations('tenant-1');

    expect(repo.resolvePeriod).toHaveBeenCalledWith(fakeClient, null, null, 1);
    expect(ops.trips.inProgress).toBe(2);
    expect(ops.orders.deliveredToday).toBe(7);
    expect(ops.stock.lotsUngraded).toBe(2);
  });
});

describe('subtractMoney', () => {
  it.each([
    ['10000.00', '8000.00', '2000.00'],
    ['0.10', '0.30', '-0.20'],
    ['100', '0.05', '99.95'],
    ['-5.50', '1.25', '-6.75'],
  ])('%s - %s = %s', (a, b, expected) => {
    expect(subtractMoney(a, b)).toBe(expected);
  });
});
