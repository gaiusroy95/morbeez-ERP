// The finance engine's write-side records: invoices, payments both ways,
// finance charges and costs, credit status. Money is a decimal string
// throughout (Constitution III.2). Mirrored in packages/shared-types/src/finance.

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque';
export type InvoiceKind = 'sale' | 'finance_charge';
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
  sourceInvoiceId: string | null; // the overdue invoice a finance charge accrued on
  issuedAt: Date;
  dueDate: string; // YYYY-MM-DD
  amount: string;
  paid: string;
  outstanding: string;
  state: InvoiceState;
  lines?: InvoiceLineRecord[]; // detail only
  payments?: { paymentId: string; amount: string; receivedAt: Date; method: PaymentMethod; reversed: boolean }[]; // detail only
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
  collectionId: string | null; // set when the money was collected on a delivery trip
  receivedAt: Date;
  applied: string;
  unapplied: string; // held on the customer's account, applied to their next invoice
  reversedAt: Date | null;
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
  paidAt: Date;
  applied: string;
  unapplied: string; // an advance, drawn down by the farmer's next graded lots
  allocations?: { lotId: string; amount: string; allocatedAt: Date }[];
}

export interface LotPaymentStatus {
  lotId: string;
  payable: string;
  paid: string;
  outstanding: string;
}

export interface FinanceChargeRecord {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string;
  customerId: string;
  customerName: string;
  periodStart: string;
  periodEnd: string;
  principal: string;
  rateMonthlyPercent: string;
  days: number;
  amount: string;
  createdAt: Date;
}

export interface FinanceChargeRunResult {
  asOf: string;
  charged: number;
  total: string;
  // Accruals under the minimum aren't posted; their days roll into the next run.
  deferredBelowMinimum: number;
  charges: FinanceChargeRecord[];
}

export type FinanceCostCategory = 'bank_charges' | 'interest' | 'payment_fee' | 'loan_processing' | 'other';

export interface FinanceCostRecord {
  id: string;
  category: FinanceCostCategory;
  amount: string;
  paidFrom: 'bank' | 'cash_on_hand';
  description: string;
  reference: string | null;
  incurredAt: Date;
}

export interface FinanceCostLine {
  // 'recorded' is a finance_cost row; the others are fees carried on a payment.
  source: 'recorded' | 'customer_payment_fee' | 'farmer_payment_fee';
  id: string;
  category: FinanceCostCategory;
  amount: string;
  description: string;
  reference: string | null;
  incurredAt: Date;
}

export interface FinanceCostsReport {
  currency: string;
  from: string;
  to: string;
  total: string;
  byCategory: { category: FinanceCostCategory; amount: string }[];
  items: FinanceCostLine[];
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
  // Receivable side (Finance owns the fact).
  invoicedOutstanding: string;
  unappliedCredit: string;
  balance: string; // invoicedOutstanding − unappliedCredit
  overdue: string;
  oldestOverdueDays: number | null;
  // Order side, as the credit check sees it.
  openOrderValue: string; // confirmed, not yet delivered
  exposure: string; // balance + openOrderValue
  available: string; // creditLimit − exposure (negative when over)
}

export interface StatementLine {
  at: Date;
  kind: 'invoice' | 'finance_charge' | 'payment' | 'payment_reversal';
  reference: string;
  description: string;
  debit: string; // increases what the customer owes
  credit: string; // decreases it
  balance: string;
}

export interface CustomerStatement {
  customerId: string;
  customerName: string;
  currency: string;
  from: string;
  to: string;
  openingBalance: string;
  closingBalance: string;
  lines: StatementLine[];
}

export interface TrialBalanceRow {
  account: string;
  name: string;
  rootType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  debit: string;
  credit: string;
  balance: string; // debit − credit
}

export interface TrialBalance {
  currency: string;
  asOf: string;
  rows: TrialBalanceRow[];
  totals: { debit: string; credit: string };
  balanced: boolean;
  // Control accounts reconciled against their sub-ledgers.
  checks: { name: string; ledger: string; subledger: string; agrees: boolean }[];
}
