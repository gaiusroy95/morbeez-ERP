import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { sumMoney } from '../../common/money';
import { assertRealDate, daysInclusive } from '../../common/period';
import { FinanceRepository, ResolvedRange, TenantMoneyContext } from './repositories/finance.repository';
import {
  CashFlowReport,
  PayablesReport,
  ReceivablesReport,
  TripCashReport,
  UnsettledLot,
} from './entities/finance.entity';

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;
const RECENT_MOVEMENTS = 50;
const RECENT_RECONCILIATIONS = 20;

// Same window the dashboard's farmer_payments_overdue alert uses
// (ALERT_THRESHOLDS.farmerPaymentOverdueAfterDays) — keep the two equal so
// the alert count and this report's overdue column agree.
export const PAYABLE_OVERDUE_DAYS = 7;

/**
 * Operational money views — who owes us, whom we owe, and where cash went.
 * Not the ledger: there is no Accounting module posting journals yet, so
 * every figure here is derived from collections, settlements, trip
 * expenses, and reconciliations.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly finance: FinanceRepository,
  ) {}

  getReceivables(tenantId: string): Promise<ReceivablesReport> {
    return this.db.withTenant(tenantId, async (client) => {
      const context = await this.tenantContext(client);
      const rows = await this.finance.receivables(client);
      const customers = rows.map((row) => ({
        customerId: row.customer_id,
        customerName: row.customer_name,
        creditLimit: row.credit_limit,
        paymentTermsDays: row.payment_terms_days,
        delivered: row.delivered,
        collected: row.collected,
        outstanding: row.outstanding,
        notYetDue: row.not_yet_due,
        overdue1To30: row.overdue_1_30,
        overdue31To60: row.overdue_31_60,
        overdueOver60: row.overdue_over_60,
        openOrderValue: row.open_order_value,
        lastCollectionAt: row.last_collection_at,
      }));
      return {
        currency: context.currency,
        totals: {
          outstanding: sumMoney(customers.map((c) => c.outstanding)),
          notYetDue: sumMoney(customers.map((c) => c.notYetDue)),
          overdue: sumMoney(customers.flatMap((c) => [c.overdue1To30, c.overdue31To60, c.overdueOver60])),
        },
        customers,
      };
    });
  }

  getPayables(tenantId: string): Promise<PayablesReport> {
    return this.db.withTenant(tenantId, async (client) => {
      const context = await this.tenantContext(client);
      const rows = await this.finance.payables(client, PAYABLE_OVERDUE_DAYS);
      const farmers = rows.map((row) => ({
        farmerId: row.farmer_id,
        farmerName: row.farmer_name,
        owed: row.owed,
        overdue: row.overdue,
        unsettledLots: row.unsettled_lots,
        oldestUnsettledGradedAt: row.oldest_unsettled_graded_at,
        lastSettledAt: row.last_settled_at,
      }));
      return {
        currency: context.currency,
        overdueAfterDays: PAYABLE_OVERDUE_DAYS,
        totals: {
          owed: sumMoney(farmers.map((f) => f.owed)),
          overdue: sumMoney(farmers.map((f) => f.overdue)),
        },
        farmers,
      };
    });
  }

  getUnsettledLots(tenantId: string, farmerId: string): Promise<UnsettledLot[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const rows = await this.finance.unsettledLotsForFarmer(client, farmerId);
      return rows.map((row) => ({
        lotId: row.lot_id,
        purchaseOrderId: row.purchase_order_id,
        productId: row.product_id,
        productName: row.product_name,
        acceptedQuantity: row.accepted_quantity,
        unitCost: row.unit_cost,
        value: row.value,
        gradedAt: row.graded_at,
      }));
    });
  }

  getCashFlow(tenantId: string, query: PeriodQueryDto): Promise<CashFlowReport> {
    return this.db.withTenant(tenantId, async (client) => {
      // Sequential — one pooled client runs one query at a time.
      const range = await this.resolveRange(client, query);
      const totals = await this.finance.cashTotals(client, range.startAt, range.endAt);
      const daily = await this.finance.cashByDay(
        client,
        range.timezone,
        range.fromDate,
        range.toDate,
        range.startAt,
        range.endAt,
      );
      const recent = await this.finance.recentCashMovements(client, range.startAt, range.endAt, RECENT_MOVEMENTS);
      return {
        currency: range.currency,
        from: range.fromDate,
        to: range.toDate,
        totals: {
          cashIn: totals.cash_in,
          settlementsOut: totals.settlements_out,
          expensesOut: totals.expenses_out,
          net: totals.net,
        },
        daily: daily.map((d) => ({ date: d.date, cashIn: d.cash_in, cashOut: d.cash_out })),
        recent: recent.map((m) => ({
          at: m.at,
          kind: m.kind,
          counterparty: m.counterparty,
          detail: m.detail,
          amount: m.amount,
          referenceId: m.reference_id,
        })),
      };
    });
  }

  getTripCash(tenantId: string): Promise<TripCashReport> {
    return this.db.withTenant(tenantId, async (client) => {
      const context = await this.tenantContext(client);
      const awaiting = await this.finance.tripsAwaitingReconciliation(client);
      const recent = await this.finance.recentReconciliations(client, RECENT_RECONCILIATIONS);
      return {
        currency: context.currency,
        awaiting: awaiting.map((t) => ({
          tripId: t.trip_id,
          vehicleRegistration: t.vehicle_registration,
          driverName: t.driver_name,
          completedAt: t.completed_at,
          advanceAmount: t.advance_amount,
          expenses: t.expenses,
          cashCollected: t.cash_collected,
        })),
        recent: recent.map((r) => ({
          tripId: r.trip_id,
          vehicleRegistration: r.vehicle_registration,
          driverName: r.driver_name,
          reconciledAt: r.reconciled_at,
          advanceAmount: r.advance_amount,
          totalExpenses: r.total_expenses,
          cashReturned: r.cash_returned,
          variance: r.variance,
        })),
      };
    });
  }

  private async tenantContext(client: PoolClient): Promise<TenantMoneyContext> {
    const context = await this.finance.tenantContext(client);
    if (!context) throw new NotFoundException('Tenant not found');
    return context;
  }

  private async resolveRange(client: PoolClient, query: PeriodQueryDto): Promise<ResolvedRange> {
    const from = query.from ?? null;
    const to = query.to ?? null;
    if (from !== null) assertRealDate(from, 'from');
    if (to !== null) assertRealDate(to, 'to');

    const range = await this.finance.resolveRange(client, from, to, query.days ?? DEFAULT_PERIOD_DAYS);
    if (!range) throw new NotFoundException('Tenant not found');
    const days = daysInclusive(range.fromDate, range.toDate);
    if (days < 1) throw new BadRequestException('from must be on or before to');
    if (days > MAX_PERIOD_DAYS) {
      throw new BadRequestException(`A cash-flow period can span at most ${MAX_PERIOD_DAYS} days`);
    }
    return range;
  }
}
