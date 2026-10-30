// Reports (owner app redesign Phase 7, screen 18): one shape for every
// report — columns and rows the owner app shows as a table, downloads as
// CSV and prints to PDF. Money and quantities are decimal strings
// (Constitution III.2). Mirrored in packages/shared-types/src/dashboard.

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
  /** Added up in the totals row. */
  total?: boolean;
}

export type ReportCell = string | number | null;

export interface ReportTable {
  kind: ReportKind;
  title: string;
  /** The dates it covers; null for a master list. */
  from: string | null;
  to: string | null;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  /** More rows than a report returns: narrow the dates. */
  truncated: boolean;
}
