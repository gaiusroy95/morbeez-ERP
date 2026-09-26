// Mirrored field-for-field in packages/shared-types/src/dashboard for the
// owner app. Money is always a decimal string (Constitution III.2) and is
// computed in SQL, never summed as a JS number.

export interface DashboardPeriod {
  from: string; // YYYY-MM-DD, tenant-local
  to: string;
  previousFrom: string;
  previousTo: string;
  timezone: string;
  currency: string;
}

export type KpiKind = 'money' | 'count';

export interface KpiValue {
  kind: KpiKind;
  value: string;
  // The same-length window immediately before `period`; null for
  // point-in-time balances, which have no "previous period".
  previous: string | null;
}

export interface DashboardKpis {
  period: DashboardPeriod;
  deliveredRevenue: KpiValue;
  deliveriesCompleted: KpiValue;
  ordersBooked: KpiValue;
  bookedOrderValue: KpiValue;
  procurementSpend: KpiValue;
  collections: KpiValue;
  farmerSettlements: KpiValue;
  tripExpenses: KpiValue;
  stockOnHandValue: KpiValue;
  receivablesOutstanding: KpiValue;
  farmerPayablesOutstanding: KpiValue;
}

export interface ProductProfitLine {
  productId: string;
  productName: string;
  revenue: string;
  costedRevenue: string;
  costOfGoods: string;
  grossProfit: string;
  grossMarginPercent: string | null;
  uncostedLines: number;
}

export interface DashboardProfit {
  period: DashboardPeriod;
  revenue: string;
  costedRevenue: string;
  uncostedRevenue: string;
  costOfGoods: string;
  grossProfit: string;
  grossMarginPercent: string | null;
  tripExpenses: string;
  operatingContribution: string;
  byProduct: ProductProfitLine[];
}

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertCode =
  | 'cash_variance'
  | 'customer_credit_breach'
  | 'approvals_pending'
  | 'lots_awaiting_grading'
  | 'aging_stock'
  | 'farmer_payments_overdue'
  | 'trips_unreconciled';

export interface DashboardAlert {
  code: AlertCode;
  severity: AlertSeverity;
  count: number;
  amount: string | null;
}

export interface DashboardAlerts {
  generatedAt: string;
  currency: string;
  alerts: DashboardAlert[];
}

export interface DashboardOperations {
  date: string;
  timezone: string;
  trips: { planned: number; inProgress: number; completedToday: number; awaitingReconciliation: number };
  stops: { pendingOnActiveTrips: number; completedToday: number; skippedToday: number };
  orders: { awaitingConfirmation: number; awaitingApproval: number; awaitingDelivery: number; deliveredToday: number };
  procurement: { purchaseOrdersPlaced: number; awaitingReceipt: number; awaitingGrading: number; pickupsScheduledToday: number };
  stock: { lotsAvailable: number; lotsReserved: number; lotsUngraded: number };
}
