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
  /** What a payment allocation names for a row with no lot (the opening balance). */
  payableId: string;
  /** 'opening': owed when the farmer came onto Morbeez — no lot, product or quantity. */
  kind: 'lot' | 'opening';
  lotId: string | null;
  purchaseOrderId: string | null;
  productId: string | null;
  productName: string;
  acceptedQuantity: string | null;
  unitCost: string | null;
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
/** 'opening': what a customer already owed when they came onto Morbeez (OB-000001). */
export type InvoiceKind = 'sale' | 'finance_charge' | 'crate_charge' | 'spot_sale' | 'opening';

/** POST finance/customers/:id/opening-balance and finance/farmers/:id/opening-balance (accounting:post). */
export interface OpeningBalanceBody {
  amount: number;
  /** YYYY-MM-DD, today if left out; not in a closed period. */
  asOf?: IsoDate;
  /** YYYY-MM-DD, the as-of day if left out. */
  dueDate?: IsoDate;
  note?: string;
}
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
  /** Taken off by credit notes (CN.1). */
  credited: string;
  /** Written off as a bad debt (BD.2). */
  writtenOff: string;
  outstanding: string;
  state: InvoiceState;
  /** Bill-to-Bill (MS §30): due when the next bill is issued, or at dueDate's backstop if sooner. */
  billToBill: boolean;
  /** Who issued it — they can't approve a credit note against it (CN.4). */
  createdBy: string;
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
  /** lotId null: the opening balance. */
  allocations?: { lotId: string | null; amount: string; allocatedAt: IsoDateTime }[];
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
  financeChargeRateAnnual: string;
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
  /** A lot by its id, or the opening balance by its payableId — one of the two. */
  allocations?: ({ lotId: string; amount: number } | { payableId: string; amount: number })[];
}

/** An invoice dispute (client Q&A, finance): finance charges pause on its amount while it's open. */
export interface InvoiceDispute {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: string;
  reason: string;
  status: 'open' | 'resolved' | 'withdrawn';
  notes: { at: IsoDateTime; by: string; text: string }[];
  raisedBy: string;
  raisedAt: IsoDateTime;
  lastActivityAt: IsoDateTime;
  /** Days since anyone last touched it; 30 makes it a critical exception. */
  idleDays: number;
  resolvedAt: IsoDateTime | null;
  resolution: string | null;
  /** Once closed (MS §32): what was accepted (credited) and what wasn't (charged from the original due date). */
  acceptedAmount: string | null;
  rejectedAmount: string | null;
  creditNoteId: string | null;
  creditNoteNumber: string | null;
  version: number;
}

/** A credit note (Accounting Engine CN.1–CN.4): what the customer owes less on one invoice, GST included. */
export interface CreditNoteRecord {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  disputeId: string | null;
  reason: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  amount: string;
  issuedAt: IsoDateTime;
  issuedBy: string;
  issuedByLogin: string | null;
}

/** A receivable written off as a bad debt (BD.2) — by the owner or a finance lead, never automatically. */
export interface ReceivableWriteOffRecord {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: string;
  reason: string;
  writtenOffAt: IsoDateTime;
  writtenOffBy: string;
  writtenOffByLogin: string | null;
}

/** An agent's commission account (MS §11; AGT.1–AGT.3): earned on graded lots, settled by payments. */
export interface AgentAccount {
  agentId: string;
  name: string;
  phone: string | null;
  pan: string | null;
  status: 'active' | 'archived';
  earned: string;
  settled: string;
  owed: string;
  commissions?: {
    id: string;
    lotId: string;
    purchaseOrderId: string;
    purchaseOrderNumber: number;
    productName: string;
    acceptedKg: string;
    ratePerKg: string;
    amount: string;
    accruedAt: IsoDateTime;
  }[];
  payments?: {
    id: string;
    agentId: string;
    amount: string;
    tdsSection: string | null;
    tdsAmount: string;
    netPaid: string;
    method: PaymentMethod;
    reference: string | null;
    paidAt: IsoDateTime;
  }[];
}

/** GET /finance/collections — the owner's Collections (redesign V1.1, screen 14). */
export type CollectionsView = 'today' | 'pending' | 'all';

export interface CollectionCard {
  /** A payment received, or a customer whose money has fallen due and isn't in. */
  kind: 'payment' | 'due';
  id: string;
  customerId: string;
  customerName: string;
  place: string | null;
  /** Collected, or due now. */
  amount: string;
  receivedAt: IsoDateTime | null;
  method: string | null;
  dueDate: string | null;
  overdueDays: number | null;
  status: 'paid' | 'partial' | 'pending';
  /** What the customer owes now. */
  balance: string;
}

export interface CollectionsBoard {
  view: CollectionsView;
  counts: { today: number; pending: number; all: number };
  totals: { collectedToday: string; dueNow: string };
  items: CollectionCard[];
  total: number;
  page: number;
  pageSize: number;
}
