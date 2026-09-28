import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { compareMoney, subtractMoney, sumMoney } from '../../common/money';
import { assertRealDate, daysInclusive } from '../../common/period';
import { CustomersService } from '../customers/customers.service';
import { FinanceRepository, ResolvedRange, TenantMoneyContext } from './repositories/finance.repository';
import { ReceivablesService } from './receivables.service';
import { CashFlowReport, PayableLot, PayablesReport, ReceivablesReport, TripCashReport } from './entities/finance.entity';
import { CustomerCreditStatus, CustomerStatement, TrialBalance } from './entities/finance-engine.entity';

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;
const RECENT_MOVEMENTS = 50;
const RECENT_RECONCILIATIONS = 20;

// Same window the dashboard's farmer_payments_overdue alert uses
// (ALERT_THRESHOLDS.farmerPaymentOverdueAfterDays) — keep the two equal so
// the alert count and this report's overdue column agree.
export const PAYABLE_OVERDUE_DAYS = 7;

/**
 * Finance's reports: who owes us, whom we owe, where cash went, customer
 * statements, credit standing, and the trial balance. Reads only — the
 * writes live in ReceivablesService, PayablesService, FinanceCostsService.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly finance: FinanceRepository,
    private readonly receivables: ReceivablesService,
    private readonly customers: CustomersService,
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
        creditHold: row.credit_hold,
        invoiced: row.invoiced,
        collected: row.collected,
        outstanding: row.outstanding,
        creditOnAccount: row.credit_on_account,
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
          creditOnAccount: sumMoney(customers.map((c) => c.creditOnAccount)),
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
        unpaidLots: row.unpaid_lots,
        oldestUnpaidAccruedAt: row.oldest_unpaid_accrued_at,
        advance: row.advance,
        lastPaidAt: row.last_paid_at,
      }));
      return {
        currency: context.currency,
        overdueAfterDays: PAYABLE_OVERDUE_DAYS,
        totals: {
          owed: sumMoney(farmers.map((f) => f.owed)),
          overdue: sumMoney(farmers.map((f) => f.overdue)),
          advances: sumMoney(farmers.map((f) => f.advance)),
        },
        farmers,
      };
    });
  }

  getPayableLots(tenantId: string, farmerId: string): Promise<PayableLot[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const rows = await this.finance.payableLotsForFarmer(client, farmerId);
      return rows.map((row) => ({
        lotId: row.lot_id,
        purchaseOrderId: row.purchase_order_id,
        productId: row.product_id,
        productName: row.product_name,
        acceptedQuantity: row.accepted_quantity,
        unitCost: row.unit_cost,
        amount: row.amount,
        paid: row.paid,
        outstanding: row.outstanding,
        accruedAt: row.accrued_at,
      }));
    });
  }

  getCashFlow(tenantId: string, query: PeriodQueryDto): Promise<CashFlowReport> {
    return this.db.withTenant(tenantId, async (client) => {
      // Sequential — one pooled client runs one query at a time.
      const range = await this.resolveRangeWithClient(client, query);
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
          farmerPaymentsOut: totals.farmer_payments_out,
          expensesOut: totals.expenses_out,
          financeCostsOut: totals.finance_costs_out,
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

  /**
   * The customer's credit standing exactly as Orders' credit check sees it:
   * exposure = what they owe now (net of credit on account) + confirmed,
   * undelivered orders.
   */
  async getCreditStatus(tenantId: string, customerId: string): Promise<CustomerCreditStatus> {
    const customer = await this.customers.getById(tenantId, customerId);
    return this.db.withTenant(tenantId, async (client) => {
      const context = await this.tenantContext(client);
      const balance = await this.receivables.customerBalanceWithClient(client, customerId);
      const openOrderValue = await this.finance.openOrderValue(client, customerId);
      const exposure = sumMoney([balance.balance, openOrderValue]);
      return {
        customerId,
        customerName: customer.name,
        currency: context.currency,
        creditLimit: customer.creditLimit,
        paymentTermsDays: customer.paymentTermsDays,
        financeChargeRateMonthly: customer.financeChargeRateMonthly,
        financeChargeGraceDays: customer.financeChargeGraceDays,
        creditHold: customer.creditHold,
        creditHoldReason: customer.creditHoldReason,
        invoicedOutstanding: balance.invoicedOutstanding,
        unappliedCredit: balance.unappliedCredit,
        balance: balance.balance,
        overdue: balance.overdue,
        oldestOverdueDays: balance.oldestOverdueDays,
        openOrderValue,
        exposure,
        available: subtractMoney(customer.creditLimit, exposure),
      };
    });
  }

  async getStatement(tenantId: string, customerId: string, query: PeriodQueryDto): Promise<CustomerStatement> {
    const customer = await this.customers.getById(tenantId, customerId);
    return this.db.withTenant(tenantId, async (client) => {
      const range = await this.resolveRangeWithClient(client, { days: 90, ...query });
      const { opening, lines } = await this.finance.statement(client, customerId, range.startAt, range.endAt);
      return {
        customerId,
        customerName: customer.name,
        currency: range.currency,
        from: range.fromDate,
        to: range.toDate,
        openingBalance: opening,
        closingBalance: lines.length > 0 ? lines[lines.length - 1].balance : opening,
        lines: lines.map((l) => ({
          at: l.at,
          kind: l.kind,
          reference: l.reference,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          balance: l.balance,
        })),
      };
    });
  }

  /**
   * Sums the ledger per account and checks the two things that must always
   * hold: debits equal credits (DE.1), and each control account agrees with
   * the sub-ledger built from invoices, payables, and payments.
   */
  getTrialBalance(tenantId: string, asOf?: string): Promise<TrialBalance> {
    return this.db.withTenant(tenantId, async (client) => {
      const range = await this.resolveRangeWithClient(client, { to: asOf, days: 1 });
      const rows = await this.finance.trialBalance(client, range.endAt);
      const sub = await this.finance.subledgerTotals(client);
      const byAccount = new Map(rows.map((r) => [r.account, r.balance]));
      const debit = sumMoney(rows.map((r) => r.debit));
      const credit = sumMoney(rows.map((r) => r.credit));
      const negate = (value: string) => subtractMoney('0', value);
      const checks = [
        { name: 'Accounts receivable', ledger: byAccount.get('accounts_receivable') ?? '0.00', subledger: sub.receivable },
        { name: 'Accounts payable — farmers', ledger: negate(byAccount.get('accounts_payable_farmer') ?? '0.00'), subledger: sub.payable },
        { name: 'Farmer advances', ledger: byAccount.get('farmer_advance') ?? '0.00', subledger: sub.advances },
      ];
      return {
        currency: range.currency,
        asOf: range.toDate,
        rows: rows.map((r) => ({
          account: r.account,
          name: r.name,
          rootType: r.root_type,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        })),
        totals: { debit, credit },
        balanced: compareMoney(debit, credit) === 0,
        // The sub-ledger side is "now"; only meaningful with asOf = today.
        checks: checks.map((c) => ({ ...c, agrees: compareMoney(c.ledger, c.subledger) === 0 })),
      };
    });
  }

  resolveRange(tenantId: string, query: PeriodQueryDto): Promise<ResolvedRange> {
    return this.db.withTenant(tenantId, (client) => this.resolveRangeWithClient(client, query));
  }

  private async tenantContext(client: PoolClient): Promise<TenantMoneyContext> {
    const context = await this.finance.tenantContext(client);
    if (!context) throw new NotFoundException('Tenant not found');
    return context;
  }

  private async resolveRangeWithClient(client: PoolClient, query: PeriodQueryDto): Promise<ResolvedRange> {
    const from = query.from ?? null;
    const to = query.to ?? null;
    if (from !== null) assertRealDate(from, 'from');
    if (to !== null) assertRealDate(to, 'to');

    const range = await this.finance.resolveRange(client, from, to, query.days ?? DEFAULT_PERIOD_DAYS);
    if (!range) throw new NotFoundException('Tenant not found');
    const days = daysInclusive(range.fromDate, range.toDate);
    if (days < 1) throw new BadRequestException('from must be on or before to');
    if (days > MAX_PERIOD_DAYS) {
      throw new BadRequestException(`A period can span at most ${MAX_PERIOD_DAYS} days`);
    }
    return range;
  }
}
