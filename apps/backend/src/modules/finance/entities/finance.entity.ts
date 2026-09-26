// Operational money views — derived from collections, settlements, trip
// expenses, and reconciliations. Not the ledger: there is no Accounting
// module to post journals to yet. Money is a decimal string throughout
// (Constitution III.2). Mirrored in packages/shared-types/src/finance.

export interface CustomerReceivable {
  customerId: string;
  customerName: string;
  creditLimit: string;
  paymentTermsDays: number;
  delivered: string;
  collected: string;
  outstanding: string;
  // Aging of what's unpaid, per delivered order, against its due date
  // (delivered date + the customer's payment terms). Collections are
  // recorded against a specific order, so each order ages on its own.
  notYetDue: string;
  overdue1To30: string;
  overdue31To60: string;
  overdueOver60: string;
  openOrderValue: string;
  lastCollectionAt: Date | null;
}

export interface ReceivablesReport {
  currency: string;
  totals: { outstanding: string; notYetDue: string; overdue: string };
  customers: CustomerReceivable[];
}

export interface FarmerPayable {
  farmerId: string;
  farmerName: string;
  owed: string;
  overdue: string; // graded more than PAYABLE_OVERDUE_DAYS ago and still unpaid
  unsettledLots: number;
  oldestUnsettledGradedAt: Date | null;
  lastSettledAt: Date | null;
}

export interface PayablesReport {
  currency: string;
  overdueAfterDays: number;
  totals: { owed: string; overdue: string };
  farmers: FarmerPayable[];
}

export interface UnsettledLot {
  lotId: string;
  purchaseOrderId: string;
  productId: string;
  productName: string;
  acceptedQuantity: string;
  unitCost: string;
  value: string;
  gradedAt: Date;
}

export type CashMovementKind = 'collection' | 'settlement' | 'trip_expense';

export interface CashMovement {
  at: Date;
  kind: CashMovementKind;
  counterparty: string;
  detail: string; // payment method, or the expense category
  amount: string;
  referenceId: string; // order, lot, or trip id
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
  totals: { cashIn: string; settlementsOut: string; expensesOut: string; net: string };
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
