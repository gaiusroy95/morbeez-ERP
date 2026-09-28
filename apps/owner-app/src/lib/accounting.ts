import type { ReportGroup, RootType } from '@morbeez/shared-types';

// What each kind of ledger entry is, as a person would say it.
export const ENTRY_LABEL: Record<string, string> = {
  invoice_issued: 'Invoice issued',
  cogs_recognized: 'Cost of goods sold',
  payable_accrued: 'Lot graded — owed to farmer',
  payment_received: 'Payment received',
  payment_reversed: 'Payment reversed',
  farmer_payment_made: 'Farmer paid',
  finance_charge_accrued: 'Finance charge',
  finance_cost_recorded: 'Finance cost',
  trip_advance_issued: 'Trip advance',
  trip_expense_recorded: 'Trip expense',
  trip_reconciled: 'Trip cash reconciled',
  inventory_written_off: 'Stock written off',
  manual_journal: 'Journal',
  journal_reversal: 'Journal reversal',
  period_close: 'Period close',
  period_reopen: 'Period reopened',
};

export const entryLabel = (type: string) => ENTRY_LABEL[type] ?? type.replace(/_/g, ' ');

export const ROOT_LABEL: Record<RootType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Income',
  expense: 'Expenses',
};

export const GROUP_LABEL: Record<ReportGroup, string> = {
  cash: 'Cash and bank',
  current_asset: 'Current asset',
  fixed_asset: 'Fixed asset',
  current_liability: 'Current liability',
  long_term_liability: 'Long-term liability',
  equity: 'Equity',
  sales: 'Sales',
  contra_sales: 'Returns and allowances',
  other_income: 'Other income',
  cost_of_sales: 'Cost of sales',
  operating_expense: 'Operating expense',
  finance_cost: 'Finance cost',
  other_expense: 'Other expense',
};

// Mirrors money.account's CHECK (and the backend's GROUPS_BY_ROOT).
export const GROUPS_BY_ROOT: Record<RootType, ReportGroup[]> = {
  asset: ['cash', 'current_asset', 'fixed_asset'],
  liability: ['current_liability', 'long_term_liability'],
  equity: ['equity'],
  revenue: ['sales', 'contra_sales', 'other_income'],
  expense: ['cost_of_sales', 'operating_expense', 'finance_cost', 'other_expense'],
};
