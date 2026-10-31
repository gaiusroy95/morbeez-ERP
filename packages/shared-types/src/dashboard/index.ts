// Response shapes for the backend's /dashboard endpoints — mirrors
// apps/backend/src/modules/dashboard/entities/dashboard.entity.ts field for
// field. Money is always a decimal string; format it, never do arithmetic
// on it as a JS number.

import type { DriverRequestKind } from '../logistics';

export interface DashboardPeriod {
  from: string;
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

export type HomeAlertCode = 'customers_overdue' | 'expense_approvals' | 'vehicle_documents_due' | AlertCode;

export interface HomeAlert {
  code: HomeAlertCode;
  severity: AlertSeverity;
  count: number;
  amount: string | null;
  /** Where the alert opens in the owner app. */
  href: string;
}

export interface DashboardHome {
  period: { from: string; to: string; previousFrom: string; previousTo: string; timezone: string; currency: string; name: HomePeriodName };
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

/** The Finance and Profit & Insights period tabs. */
export type RangeName = 'today' | 'week' | 'month' | 'custom';

export interface DashboardRange {
  name: RangeName;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  currency: string;
}

/** GET /dashboard/finance — the Finance hub (redesign V1.1, screen 15). */
export interface FinanceSummary {
  range: DashboardRange;
  receivables: string;
  payables: string;
  cashBalance: string;
  /** Every cost but the goods sold, in the period (from the ledger). */
  expenses: string;
}

export interface ProductProfit {
  productId: string;
  product: string;
  revenue: string;
  costOfGoods: string;
  profit: string;
  marginPercent: string | null;
}

/** GET /dashboard/insights — Profit & Insights (redesign V1.1, screen 16), from the ledger. */
export interface ProfitInsights {
  range: DashboardRange;
  revenue: string;
  revenueChangePercent: string | null;
  /** revenue − net profit: everything it took to earn the revenue. */
  totalCost: string;
  netProfit: string;
  netProfitChangePercent: string | null;
  marginPercent: string | null;
  previous: { revenue: string; netProfit: string };
  products: ProductProfit[];
}

// ---- Approvals & Exceptions (owner app redesign Phase 7, screen 17) ----

export type InboxKind = 'expense' | 'purchase_order' | 'customer_order' | 'spot_price' | 'ai' | 'dispute' | 'trip_close' | 'driver_request';
export type InboxTab = 'expense' | 'price' | 'other';

/** GET dashboard/approvals — one thing waiting for the owner; each decision goes through its own module. */
export interface InboxItem {
  key: string;
  kind: InboxKind;
  tab: InboxTab;
  subject: string;
  detail: string | null;
  amount: string | null;
  at: string;
  by: string | null;
  refs: {
    tripId?: string;
    expenseId?: string;
    approvalRequestId?: string;
    approvalVersion?: number;
    purchaseOrderId?: string;
    orderId?: string;
    spotSaleId?: string;
    recommendationId?: string;
    disputeId?: string;
    customerId?: string;
    driverRequestId?: string;
    requestKind?: DriverRequestKind;
  };
}

export interface ApprovalsInbox {
  counts: { all: number; expense: number; price: number; other: number };
  items: InboxItem[];
}

// ---- Reports (owner app redesign Phase 7, screen 18) ----

export type ReportKind =
  | 'sales'
  | 'procurement'
  | 'customers'
  | 'products'
  | 'farmers'
  | 'trips'
  | 'vehicles'
  | 'workforce'
  | 'customer-list'
  | 'farmer-list'
  | 'product-list';

export type ReportColumnKind = 'text' | 'date' | 'money' | 'qty' | 'int' | 'pct';
export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
  total?: boolean;
}
export type ReportCell = string | number | null;

/** GET reports/:kind?from&to */
export interface ReportTable {
  kind: ReportKind;
  title: string;
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  truncated: boolean;
}

// ---- Users & permissions, My Profile (owner app redesign Phase 7) ----

/** GET users/team */
export interface TeamMember {
  userId: string;
  login: string;
  phone: string | null;
  email: string | null;
  status: 'active' | 'deactivated';
  roles: { id: string; name: string }[];
  workerName: string | null;
  createdAt: string;
}

/** GET users/roles */
export interface RoleSummary {
  id: string;
  name: string;
  permissions: string[];
  members: number;
}

/** GET users/me/activity */
export interface ActivityEntry {
  action: string;
  entityType: string;
  entityId: string;
  at: string;
}
