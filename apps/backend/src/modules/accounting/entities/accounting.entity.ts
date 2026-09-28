// The Accounting context's views over Finance's ledger: the tenant's chart
// of accounts, journal entries, the general ledger, the trial balance, the
// three financial statements, and period closes. Money is a decimal string
// throughout (Constitution III.2). Mirrored in
// packages/shared-types/src/accounting.

export type RootType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type ReportGroup =
  | 'cash'
  | 'current_asset'
  | 'fixed_asset'
  | 'current_liability'
  | 'long_term_liability'
  | 'equity'
  | 'sales'
  | 'contra_sales'
  | 'other_income'
  | 'cost_of_sales'
  | 'operating_expense'
  | 'finance_cost'
  | 'other_expense';

export const GROUPS_BY_ROOT: Record<RootType, ReportGroup[]> = {
  asset: ['cash', 'current_asset', 'fixed_asset'],
  liability: ['current_liability', 'long_term_liability'],
  equity: ['equity'],
  revenue: ['sales', 'contra_sales', 'other_income'],
  expense: ['cost_of_sales', 'operating_expense', 'finance_cost', 'other_expense'],
};

/** Assets and expenses grow with debits; liabilities, equity, and revenue with credits. */
export function normalSide(root: RootType): 'debit' | 'credit' {
  return root === 'asset' || root === 'expense' ? 'debit' : 'credit';
}

export interface AccountRecord {
  code: string;
  number: number;
  name: string;
  rootType: RootType;
  reportGroup: ReportGroup;
  normalSide: 'debit' | 'credit';
  isSystem: boolean; // the engine posts to it: can be renamed, never retired
  isControl: boolean; // has a sub-ledger (receivables, payables, stock, advances): no manual journals
  isActive: boolean;
  description: string | null;
  version: number;
  // Balance today, on the account's normal side (negative = the other side,
  // as a contra account normally is).
  balance: string;
}

export interface JournalLine {
  accountCode: string;
  accountNumber: number;
  accountName: string;
  partyType: 'customer' | 'farmer' | null;
  partyId: string | null;
  partyName: string | null;
  debit: string;
  credit: string;
}

export interface JournalEntry {
  id: string;
  entryType: string;
  // Manual journals only.
  journalNumber: number | null;
  reference: string | null;
  sourceType: string;
  sourceId: string;
  occurredAt: Date;
  date: string; // tenant-local YYYY-MM-DD
  memo: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
  total: string; // sum of debits (= sum of credits)
  lines: JournalLine[];
}

export interface GeneralLedgerLine {
  entryId: string;
  occurredAt: Date;
  date: string;
  entryType: string;
  memo: string | null;
  journalNumber: number | null;
  partyName: string | null;
  debit: string;
  credit: string;
  balance: string; // running, on the account's normal side
}

export interface GeneralLedger {
  currency: string;
  account: AccountRecord;
  from: string;
  to: string;
  opening: string;
  totals: { debit: string; credit: string };
  closing: string;
  lines: GeneralLedgerLine[];
  truncated: boolean; // more lines than one response carries — narrow the dates
}

export interface TrialBalanceLine {
  code: string;
  number: number;
  name: string;
  rootType: RootType;
  debit: string; // net balance when it's a debit, else 0
  credit: string; // net balance when it's a credit, else 0
}

export interface AccountingTrialBalance {
  currency: string;
  asOf: string;
  lines: TrialBalanceLine[];
  totals: { debit: string; credit: string };
  balanced: boolean;
}

export interface StatementLine {
  code: string;
  number: number;
  name: string;
  amount: string;
}

export interface StatementSection {
  key: ReportGroup;
  label: string;
  lines: StatementLine[];
  total: string;
}

export interface ProfitAndLossFigures {
  netSales: string; // sales less returns
  costOfSales: string;
  grossProfit: string;
  operatingExpenses: string;
  operatingProfit: string;
  otherIncome: string;
  financeCosts: string;
  otherExpenses: string;
  netProfit: string;
}

export interface ProfitAndLoss {
  currency: string;
  from: string;
  to: string;
  sections: StatementSection[];
  figures: ProfitAndLossFigures;
  // The same number of days immediately before, for comparison.
  previous: { from: string; to: string; figures: ProfitAndLossFigures };
}

export interface BalanceSheet {
  currency: string;
  asOf: string;
  assets: { sections: StatementSection[]; total: string };
  liabilities: { sections: StatementSection[]; total: string };
  equity: {
    lines: StatementLine[];
    // Revenue less expenses not yet moved to retained earnings by a period close.
    unclosedProfit: string;
    total: string;
  };
  liabilitiesAndEquity: string;
  balanced: boolean;
}

export type CashFlowActivity = 'operating' | 'investing' | 'financing';

export interface CashFlowStatementLine {
  code: string;
  name: string;
  label: string; // what the movement means, e.g. "Collected from customers"
  amount: string; // + cash in, − cash out
}

export interface CashFlowStatement {
  currency: string;
  from: string;
  to: string;
  openingCash: string;
  closingCash: string;
  netChange: string;
  activities: { activity: CashFlowActivity; lines: CashFlowStatementLine[]; total: string }[];
  cashAccounts: { code: string; name: string; opening: string; closing: string }[];
}

export interface PeriodCloseRecord {
  id: string;
  periodStart: string | null;
  periodEnd: string;
  netIncome: string;
  closingEntryId: string | null;
  notes: string | null;
  closedBy: string;
  closedByEmail: string | null;
  closedAt: Date;
  reopenedAt: Date | null;
  reopenedByEmail: string | null;
  reopenReason: string | null;
}

export interface PeriodsOverview {
  currency: string;
  lockedThrough: string | null;
  today: string;
  closes: PeriodCloseRecord[];
}

export interface ClosePreview {
  currency: string;
  periodStart: string | null;
  periodEnd: string;
  netIncome: string;
  // What the closing entry moves to retained earnings, per account.
  lines: { code: string; number: number; name: string; rootType: RootType; amount: string }[];
  blockers: string[]; // must be fixed first
  warnings: string[]; // worth a look, but don't stop the close
}
