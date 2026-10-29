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

/** GET /dashboard/home — the owner's Home screen (redesign V1.1). */
export type HomePeriodName = 'today' | 'week' | 'month';

export interface HomeAlert {
  code:
    | 'customers_overdue'
    | 'expense_approvals'
    | 'vehicle_documents_due'
    | DashboardAlert['code'];
  severity: AlertSeverity;
  count: number;
  amount: string | null;
  /** Where the alert's row opens, in the owner app. */
  href: string;
}

export interface DashboardHome {
  period: DashboardPeriod & { name: HomePeriodName };
  /** Sales − purchases for the period. */
  netContribution: { value: string; previous: string; changePercent: string | null };
  sales: string;
  purchases: string;
  receivables: string;
  payables: string;
  cash: string;
  activeTrips: { active: number; total: number };
  today: { procurement: number; deliveries: number; collections: number; activeTrips: number };
  alerts: HomeAlert[];
  insight: { id: string; title: string; explanation: string } | null;
}

/** A period on the Finance and Profit & Insights tabs, as dates in the business's timezone. */
export interface DashboardRange {
  name: 'today' | 'week' | 'month' | 'custom';
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  currency: string;
}

/**
 * The owner's Finance hub (redesign V1.1, screen 15): what customers owe,
 * what's owed to farmers and cash in hand and bank, as they stand now —
 * and what was spent in the period (every cost but the goods sold, from
 * the ledger's profit and loss).
 */
export interface FinanceSummary {
  range: DashboardRange;
  receivables: string;
  payables: string;
  cashBalance: string;
  expenses: string;
}

/** One product's sales in the period, against what the kilos sold cost. */
export interface ProductProfit {
  productId: string;
  product: string;
  revenue: string;
  costOfGoods: string;
  profit: string;
  /** profit ÷ revenue; null with no revenue. */
  marginPercent: string | null;
}

/**
 * Profit & Insights (redesign V1.1, screen 16), from the ledger's profit
 * and loss: revenue (net sales), total cost (everything it took to earn
 * it, so revenue − total cost = net profit), net profit and its margin;
 * then product by product, sales against the cost of the kilos sold.
 */
export interface ProfitInsights {
  range: DashboardRange;
  revenue: string;
  revenueChangePercent: string | null;
  totalCost: string;
  netProfit: string;
  netProfitChangePercent: string | null;
  marginPercent: string | null;
  previous: { revenue: string; netProfit: string };
  products: ProductProfit[];
}
