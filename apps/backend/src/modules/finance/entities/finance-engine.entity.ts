// The finance engine's write-side records: invoices, payments both ways,
// finance charges and costs, credit status. Money is a decimal string
// throughout (Constitution III.2). Mirrored in packages/shared-types/src/finance.

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque';
/** 'opening': what a customer already owed when the business moved onto Morbeez (OB-000001). */
export type InvoiceKind = 'sale' | 'finance_charge' | 'crate_charge' | 'spot_sale' | 'opening';
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
  /** Taken off by credit notes (CN.1). */
  credited: string;
  /** Written off as a bad debt (BD.2). */
  writtenOff: string;
  outstanding: string;
  state: InvoiceState;
  /** Bill-to-Bill (MS §30): due when the customer's next bill is issued, or at dueDate's backstop if sooner. */
  billToBill: boolean;
  /** The user who issued it — not the one who may approve a credit note against it (CN.4). */
  createdBy: string;
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
  /** Charges before the pilot formula: percent per 30 days. */
  rateMonthlyPercent: string | null;
  /** Percent a year, charged per day (÷ 365). */
  rateAnnualPercent: string | null;
  days: number;
  amount: string;
  createdAt: Date;
  /** Set on a catch-up: the dispute whose paused days this charges (MS §32). */
  disputeId: string | null;
}

export interface FinanceChargeRunResult {
  asOf: string;
  charged: number;
  total: string;
  // Accruals under the minimum aren't posted; their days roll into the next run.
  deferredBelowMinimum: number;
  charges: FinanceChargeRecord[];
}

/** A credit note (Accounting Engine CN.1–CN.4): what the customer owes less on one invoice, GST included. */
export interface CreditNoteRecord {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  /** The dispute whose accepted amount it is; null when issued directly. */
  disputeId: string | null;
  reason: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  amount: string;
  issuedAt: Date;
  issuedBy: string;
  issuedByLogin: string | null;
}

/** A receivable written off as uncollectible (BD.2) — by the owner or a finance lead, never automatically. */
export interface ReceivableWriteOffRecord {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: string;
  reason: string;
  writtenOffAt: Date;
  writtenOffBy: string;
  writtenOffByLogin: string | null;
}

/** An agent's commission account (AGT.1–AGT.3): earned on graded lots, settled by payments. */
export interface AgentCommissionRecord {
  id: string;
  lotId: string;
  purchaseOrderId: string;
  purchaseOrderNumber: number;
  productName: string;
  acceptedKg: string;
  ratePerKg: string;
  amount: string;
  accruedAt: Date;
}

export interface AgentPaymentRecord {
  id: string;
  agentId: string;
  amount: string;
  tdsSection: string | null;
  tdsAmount: string;
  /** What reached the agent: amount − TDS. */
  netPaid: string;
  method: PaymentMethod;
  reference: string | null;
  paidAt: Date;
}

export interface AgentAccount {
  agentId: string;
  name: string;
  phone: string | null;
  pan: string | null;
  status: 'active' | 'archived';
  earned: string;
  settled: string;
  owed: string;
  commissions?: AgentCommissionRecord[]; // detail only
  payments?: AgentPaymentRecord[]; // detail only
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
  financeChargeRateAnnual: string;
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
  kind: 'invoice' | 'finance_charge' | 'payment' | 'payment_reversal' | 'credit_note' | 'write_off';
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
