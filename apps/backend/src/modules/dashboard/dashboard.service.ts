import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AlertThresholds, DashboardRepository, ResolvedPeriod } from './repositories/dashboard.repository';
import {
  AlertSeverity,
  DashboardAlert,
  DashboardAlerts,
  DashboardKpis,
  DashboardOperations,
  DashboardPeriod,
  DashboardProfit,
  KpiValue,
} from './entities/dashboard.entity';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { subtractMoney } from '../../common/money';
import { assertRealDate, daysInclusive } from '../../common/period';

export { subtractMoney };

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;
const TOP_PRODUCTS = 10;

// Vegetables are perishable: these windows are set for produce, not for
// durable goods. Kept here, next to the alert logic that reads them, so
// changing one is a one-line, reviewable diff.
export const ALERT_THRESHOLDS: AlertThresholds = {
  ungradedAfterHours: 12,
  agingStockAfterDays: 3,
  unreconciledAfterHours: 24,
  cashVarianceLookbackDays: 30,
  farmerPaymentOverdueAfterDays: 7,
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly dashboard: DashboardRepository,
  ) {}

  getKpis(tenantId: string, query: PeriodQueryDto): Promise<DashboardKpis> {
    return this.db.withTenant(tenantId, async (client) => {
      // Sequential, not Promise.all — one pooled client runs one query at a time.
      const period = await this.resolvePeriod(client, query);
      const current = await this.dashboard.periodFlows(client, period.startAt, period.endAt);
      const previous = await this.dashboard.periodFlows(client, period.previousStartAt, period.startAt);
      const balances = await this.dashboard.balances(client);

      const money = (value: string, prior: string | null): KpiValue => ({ kind: 'money', value, previous: prior });
      const count = (value: number, prior: number): KpiValue => ({
        kind: 'count',
        value: String(value),
        previous: String(prior),
      });

      return {
        period: toPeriod(period),
        deliveredRevenue: money(current.delivered_revenue, previous.delivered_revenue),
        deliveriesCompleted: count(current.deliveries_completed, previous.deliveries_completed),
        ordersBooked: count(current.orders_booked, previous.orders_booked),
        bookedOrderValue: money(current.booked_order_value, previous.booked_order_value),
        procurementSpend: money(current.procurement_spend, previous.procurement_spend),
        collections: money(current.collections, previous.collections),
        farmerSettlements: money(current.farmer_settlements, previous.farmer_settlements),
        tripExpenses: money(current.trip_expenses, previous.trip_expenses),
        stockOnHandValue: money(balances.stock_on_hand_value, null),
        receivablesOutstanding: money(balances.receivables_outstanding, null),
        farmerPayablesOutstanding: money(balances.farmer_payables_outstanding, null),
      };
    });
  }

  /**
   * An operational estimate, not the ledger — Accounting doesn't post
   * journals yet. Cost of goods uses the specific lots reserved for each
   * delivered line; a line with no costed lot is reported as
   * uncostedRevenue and left out of the margin rather than counted at zero
   * cost, which would overstate profit.
   */
  getProfit(tenantId: string, query: PeriodQueryDto): Promise<DashboardProfit> {
    return this.db.withTenant(tenantId, async (client) => {
      const period = await this.resolvePeriod(client, query);
      const totals = await this.dashboard.profitTotals(client, period.startAt, period.endAt);
      const byProduct = await this.dashboard.profitByProduct(client, period.startAt, period.endAt, TOP_PRODUCTS);

      return {
        period: toPeriod(period),
        revenue: totals.revenue,
        costedRevenue: totals.costed_revenue,
        uncostedRevenue: subtractMoney(totals.revenue, totals.costed_revenue),
        costOfGoods: totals.cost_of_goods,
        grossProfit: totals.gross_profit,
        grossMarginPercent: totals.gross_margin_percent,
        tripExpenses: totals.trip_expenses,
        operatingContribution: totals.operating_contribution,
        byProduct: byProduct.map((row) => ({
          productId: row.product_id,
          productName: row.product_name,
          revenue: row.revenue,
          costedRevenue: row.costed_revenue,
          costOfGoods: row.cost_of_goods,
          grossProfit: row.gross_profit,
          grossMarginPercent: row.gross_margin_percent,
          uncostedLines: row.uncosted_lines,
        })),
      };
    });
  }

  getAlerts(tenantId: string): Promise<DashboardAlerts> {
    return this.db.withTenant(tenantId, async (client) => {
      const period = await this.resolvePeriod(client, {});
      const row = await this.dashboard.alerts(client, ALERT_THRESHOLDS);

      const candidates: DashboardAlert[] = [
        { code: 'cash_variance', severity: 'critical', count: row.variance_count, amount: row.variance_amount },
        {
          code: 'customer_credit_breach',
          severity: 'critical',
          count: row.credit_breach_count,
          amount: row.credit_breach_amount,
        },
        { code: 'approvals_pending', severity: 'warning', count: row.approvals_pending, amount: null },
        { code: 'lots_awaiting_grading', severity: 'warning', count: row.ungraded_count, amount: null },
        { code: 'aging_stock', severity: 'warning', count: row.aging_count, amount: row.aging_value },
        { code: 'farmer_payments_overdue', severity: 'warning', count: row.overdue_count, amount: row.overdue_value },
        { code: 'trips_unreconciled', severity: 'warning', count: row.unreconciled_count, amount: null },
      ];

      return {
        generatedAt: new Date().toISOString(),
        currency: period.currency,
        alerts: candidates
          .filter((alert) => alert.count > 0)
          .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
      };
    });
  }

  getOperations(tenantId: string): Promise<DashboardOperations> {
    return this.db.withTenant(tenantId, async (client) => {
      const today = await this.resolvePeriodOrThrow(client, null, null, 1);
      const row = await this.dashboard.operations(client, today.startAt, today.endAt);

      return {
        date: today.toDate,
        timezone: today.timezone,
        trips: {
          planned: row.trips_planned,
          inProgress: row.trips_in_progress,
          completedToday: row.trips_completed_today,
          awaitingReconciliation: row.trips_awaiting_reconciliation,
        },
        stops: {
          pendingOnActiveTrips: row.stops_pending,
          completedToday: row.stops_completed_today,
          skippedToday: row.stops_skipped_today,
        },
        orders: {
          awaitingConfirmation: row.orders_awaiting_confirmation,
          awaitingApproval: row.orders_awaiting_approval,
          awaitingDelivery: row.orders_awaiting_delivery,
          deliveredToday: row.orders_delivered_today,
        },
        procurement: {
          purchaseOrdersPlaced: row.pos_placed,
          awaitingReceipt: row.pos_awaiting_receipt,
          awaitingGrading: row.pos_awaiting_grading,
          pickupsScheduledToday: row.pickups_scheduled_today,
        },
        stock: {
          lotsAvailable: row.lots_available,
          lotsReserved: row.lots_reserved,
          lotsUngraded: row.lots_ungraded,
        },
      };
    });
  }

  private async resolvePeriod(client: PoolClient, query: PeriodQueryDto): Promise<ResolvedPeriod> {
    const from = query.from ?? null;
    const to = query.to ?? null;
    if (from !== null) assertRealDate(from, 'from');
    if (to !== null) assertRealDate(to, 'to');

    const period = await this.resolvePeriodOrThrow(client, from, to, query.days ?? DEFAULT_PERIOD_DAYS);
    const days = daysInclusive(period.fromDate, period.toDate);
    if (days < 1) {
      throw new BadRequestException('from must be on or before to');
    }
    if (days > MAX_PERIOD_DAYS) {
      throw new BadRequestException(`A dashboard period can span at most ${MAX_PERIOD_DAYS} days`);
    }
    return period;
  }

  private async resolvePeriodOrThrow(
    client: PoolClient,
    from: string | null,
    to: string | null,
    defaultDays: number,
  ): Promise<ResolvedPeriod> {
    const period = await this.dashboard.resolvePeriod(client, from, to, defaultDays);
    if (!period) throw new NotFoundException('Tenant not found');
    return period;
  }
}

function toPeriod(period: ResolvedPeriod): DashboardPeriod {
  return {
    from: period.fromDate,
    to: period.toDate,
    previousFrom: period.previousFrom,
    previousTo: period.previousTo,
    timezone: period.timezone,
    currency: period.currency,
  };
}
