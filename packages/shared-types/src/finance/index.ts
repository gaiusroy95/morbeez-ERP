// Response shapes for the backend's /finance endpoints — mirrors
// apps/backend/src/modules/finance/entities/finance.entity.ts (reports) and
// finance-engine.entity.ts (write-side records) field for field. Money is a
// decimal string throughout.
import type { IsoDate, IsoDateTime } from '../common';

// ---- Reports ----

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
  // Aging of open invoices by each one's own due date.
  notYetDue: string;
  overdue1To30: string;
  overdue31To60: string;
  overdueOver60: string;
  openOrderValue: string; // confirmed, not yet delivered
  lastCollectionAt: IsoDateTime | null;
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
  oldestUnpaidAccruedAt: IsoDateTime | null;
  advance: string; // paid ahead, drawn down by the farmer's next graded lots
  lastPaidAt: IsoDateTime | null;
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
  accruedAt: IsoDateTime;
}

export type CashMovementKind = 'collection' | 'collection_reversed' | 'farmer_payment' | 'trip_expense' | 'finance_cost';

export interface CashMovement {
  at: IsoDateTime;
  kind: CashMovementKind;
  counterparty: string;
  detail: string; // payment method, expense category, cost category, or reversal reason
  amount: string;
  referenceId: string; // payment, cost, or trip id
}

export interface CashDay {
  date: IsoDate; // tenant-local
  cashIn: string;
  cashOut: string;
}

export interface CashFlowReport {
  currency: string;
  from: IsoDate;
  to: IsoDate;
  totals: { cashIn: string; farmerPaymentsOut: string; expensesOut: string; financeCostsOut: string; net: string };
  daily: CashDay[];
  recent: CashMovement[];
}

export interface TripAwaitingReconciliation {
  tripId: string;
  vehicleRegistration: string;
  driverName: string;
  completedAt: IsoDateTime | null;
  advanceAmount: string;
  expenses: string;
  cashCollected: string;
}

export interface TripReconciliationSummary {
  tripId: string;
  vehicleRegistration: string;
  driverName: string;
  reconciledAt: IsoDateTime;
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

// ---- Write-side records ----

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque';
export type InvoiceKind = 'sale' | 'finance_charge' | 'crate_charge' | 'spot_sale';
export type InvoiceState = 'open' | 'overdue' | 'paid';

export interface InvoiceLineRecord {
  id: string;
  orderLineId: string | null;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  kind: InvoiceKind;
  customerId: string;
  customerName: string;
  orderId: string | null;
  sourceInvoiceId: string | null;
  issuedAt: IsoDateTime;
  dueDate: IsoDate;
  amount: string;
  paid: string;
  outstanding: string;
  state: InvoiceState;
  lines?: InvoiceLineRecord[]; // detail only
  payments?: { paymentId: string; amount: string; receivedAt: IsoDateTime; method: PaymentMethod; reversed: boolean }[];
}

export interface CustomerPaymentRecord {
  id: string;
  customerId: string;
  customerName: string;
  amount: string;
  feeAmount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  collectionId: string | null; // set when collected on a delivery trip
  receivedAt: IsoDateTime;
  applied: string;
  unapplied: string; // held on account, applied to the customer's next invoice
  reversedAt: IsoDateTime | null;
  reversalReason: string | null;
  allocations?: { invoiceId: string; invoiceNumber: string; amount: string }[];
}

export interface FarmerPaymentRecord {
  id: string;
  farmerId: string;
  farmerName: string;
  amount: string;
  feeAmount: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  paidAt: IsoDateTime;
  applied: string;
  unapplied: string; // an advance, drawn down by the farmer's next graded lots
  allocations?: { lotId: string; amount: string; allocatedAt: IsoDateTime }[];
}

/** GET /procurement/purchase-orders/:id/settlements — what each lot of a PO owes and has been paid. */
export interface LotPaymentStatus {
  lotId: string;
  payable: string;
  paid: string;
  outstanding: string;
}

export interface CustomerCreditStatus {
  customerId: string;
  customerName: string;
  currency: string;
  creditLimit: string;
  paymentTermsDays: number;
  financeChargeRateMonthly: string;
  financeChargeGraceDays: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  invoicedOutstanding: string;
  unappliedCredit: string;
  balance: string; // invoicedOutstanding − unappliedCredit
  overdue: string;
  oldestOverdueDays: number | null;
  openOrderValue: string;
  exposure: string; // balance + openOrderValue
  available: string; // creditLimit − exposure (negative when over)
}

// Request bodies.
export interface RecordCustomerPaymentBody {
  customerId: string;
  amount: number;
  feeAmount?: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  receivedAt?: IsoDateTime;
  allocations?: { invoiceId: string; amount: number }[];
}

export interface RecordFarmerPaymentBody {
  farmerId: string;
  amount: number;
  feeAmount?: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  paidAt?: IsoDateTime;
  allocations?: { lotId: string; amount: number }[];
}
