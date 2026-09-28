// Finance's reports — receivables, payables, cash flow, trip cash — read
// from invoices, payables, and payments the finance engine records (each
// backed by a ledger entry). Money is a decimal string throughout
// (Constitution III.2). Mirrored in packages/shared-types/src/finance.

export interface CustomerReceivable {
  customerId: string;
  customerName: string;
  creditLimit: string;
  paymentTermsDays: number;
  creditHold: boolean;
  invoiced: string; // sale invoices, all time
  collected: string; // payments received, net of reversals, all time
  outstanding: string; // open invoices, including finance charges
  creditOnAccount: string; // paid in but not yet applied to an invoice
  // Aging of open invoices by each one's own due date (issue date + the
  // payment terms in force when it was issued).
  notYetDue: string;
  overdue1To30: string;
  overdue31To60: string;
  overdueOver60: string;
  openOrderValue: string; // confirmed, not yet delivered
  lastCollectionAt: Date | null;
}

export interface ReceivablesReport {
  currency: string;
  totals: { outstanding: string; notYetDue: string; overdue: string; creditOnAccount: string };
  customers: CustomerReceivable[];
}

export interface FarmerPayable {
  farmerId: string;
  farmerName: string;
  owed: string;
  overdue: string; // accrued more than overdueAfterDays ago and still unpaid
  unpaidLots: number;
  oldestUnpaidAccruedAt: Date | null;
  advance: string; // paid ahead, drawn down by the farmer's next graded lots
  lastPaidAt: Date | null;
}

export interface PayablesReport {
  currency: string;
  overdueAfterDays: number;
  totals: { owed: string; overdue: string; advances: string };
  farmers: FarmerPayable[];
}

export interface PayableLot {
  lotId: string;
  purchaseOrderId: string;
  productId: string;
  productName: string;
  acceptedQuantity: string;
  unitCost: string;
  amount: string;
  paid: string;
  outstanding: string;
  accruedAt: Date;
}

export type CashMovementKind = 'collection' | 'collection_reversed' | 'farmer_payment' | 'trip_expense' | 'finance_cost';

export interface CashMovement {
  at: Date;
  kind: CashMovementKind;
  counterparty: string;
  detail: string; // payment method, expense category, cost category, or reversal reason
  amount: string;
  referenceId: string; // payment, cost, or trip id
}

export interface CashDay {
  date: string; // YYYY-MM-DD, tenant-local
  cashIn: string;
  cashOut: string;
}

export interface CashFlowReport {
  currency: string;
  from: string;
  to: string;
  totals: { cashIn: string; farmerPaymentsOut: string; expensesOut: string; financeCostsOut: string; net: string };
  daily: CashDay[];
  recent: CashMovement[];
}

export interface TripAwaitingReconciliation {
  tripId: string;
  vehicleRegistration: string;
  driverName: string;
  completedAt: Date | null;
  advanceAmount: string;
  expenses: string;
  cashCollected: string;
}

export interface TripReconciliationSummary {
  tripId: string;
  vehicleRegistration: string;
  driverName: string;
  reconciledAt: Date;
  advanceAmount: string;
  totalExpenses: string;
  cashReturned: string;
  variance: string;
}

export interface TripCashReport {
  currency: string;
  awaiting: TripAwaitingReconciliation[];
  recent: TripReconciliationSummary[];
}
