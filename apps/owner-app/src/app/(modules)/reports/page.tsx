'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReportCell, ReportColumn, ReportKind, ReportTable } from '@morbeez/shared-types';
import { DayTabs } from '@/components/redesign/ListCards';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import type { DateRange } from '@/lib/hooks/use-accounting';
import { useReport } from '@/lib/hooks/use-admin';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatMoney, formatQuantity, todayIn } from '@/lib/format';
import { useT } from '@/lib/i18n';

type Tab = 'operational' | 'financial' | 'sales';

interface Entry {
  label: string;
  description: string;
  icon: IconName;
  /** A report shown here, or a statement that has its own screen. */
  kind?: ReportKind;
  href?: string;
  permission: string;
}

const SALES: Entry = { kind: 'sales', label: 'Sales report', description: 'Customer, product, route', icon: 'receipt', permission: 'finance:read' };
const PROCUREMENT: Entry = { kind: 'procurement', label: 'Procurement report', description: 'Farmer, product, purchase price', icon: 'basket', permission: 'procurement:read' };
const CUSTOMERS: Entry = { kind: 'customers', label: 'Customer profitability', description: 'Margin, payments, what they owe', icon: 'users', permission: 'finance:read' };
const PRODUCTS: Entry = { kind: 'products', label: 'Product report', description: 'Sales, cost, margin', icon: 'leaf', permission: 'dashboard:profit' };
const FARMERS: Entry = { kind: 'farmers', label: 'Farmer report', description: 'Purchases, payments, outstanding', icon: 'sprout', permission: 'finance:read' };
const TRIPS: Entry = { kind: 'trips', label: 'Trip / Route report', description: 'Trip KM, deliveries, collections, expenses', icon: 'truck', permission: 'logistics:dispatch' };
const VEHICLES: Entry = { kind: 'vehicles', label: 'Vehicle report', description: 'Usage, cost, maintenance', icon: 'steering', permission: 'vehicles:read' };
const WORKFORCE: Entry = { kind: 'workforce', label: 'Workforce report', description: 'Days worked, earnings, incentives', icon: 'badge', permission: 'payroll:read' };
const EXPORT: Entry = { label: 'Export data', description: 'Customers, farmers, products', icon: 'download', permission: 'customers:read', href: '#export' };

const ENTRIES: Record<Tab, Entry[]> = {
  operational: [SALES, PROCUREMENT, CUSTOMERS, PRODUCTS, FARMERS, TRIPS, VEHICLES, WORKFORCE, EXPORT],
  financial: [
    { label: 'Profit & loss', description: 'Income and costs for a period', icon: 'chart', permission: 'accounting:read', href: '/accounting#pnl' },
    { label: 'Balance sheet', description: 'What the business owns and owes', icon: 'book', permission: 'accounting:read', href: '/accounting#balance-sheet' },
    { label: 'Trial balance', description: 'Every account, debits and credits', icon: 'book', permission: 'accounting:read', href: '/accounting#trial-balance' },
    { label: 'GST returns', description: 'GSTR-1 and GSTR-3B', icon: 'percent', permission: 'tax:read', href: '/tax' },
    CUSTOMERS,
    FARMERS,
  ],
  sales: [SALES, CUSTOMERS, PRODUCTS],
};

const LISTS: { kind: ReportKind; label: string; permission: string }[] = [
  { kind: 'customer-list', label: 'Customers', permission: 'customers:read' },
  { kind: 'farmer-list', label: 'Farmers', permission: 'farmers:read' },
  { kind: 'product-list', label: 'Products', permission: 'products:read' },
];

/** A cell as the owner reads it. */
function show(cell: ReportCell, column: ReportColumn, currency: string): string {
  if (cell === null || cell === undefined || cell === '') return '—';
  switch (column.kind) {
    case 'money':
      return formatMoney(String(cell), currency);
    case 'qty':
      return formatQuantity(String(cell));
    case 'pct':
      return `${cell}%`;
    case 'date':
      return formatDate(String(cell));
    case 'int':
      return Number(cell).toLocaleString('en-IN');
    default:
      return String(cell);
  }
}

/** The report as CSV — figures as plain numbers, so a spreadsheet adds them up. */
function csvOf(table: ReportTable): string {
  const quote = (v: ReportCell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [table.columns.map((c) => quote(c.label)).join(',')];
  for (const row of table.rows) lines.push(table.columns.map((c) => quote(row[c.key])).join(','));
  if (table.totals) lines.push(table.columns.map((c, i) => quote(i === 0 ? 'Total' : (table.totals?.[c.key] ?? ''))).join(','));
  return lines.join('\r\n');
}

function download(table: ReportTable) {
  // A byte-order mark so Excel reads ₹ and names in every language correctly.
  const blob = new Blob(['﻿', csvOf(table)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${table.kind}${table.from ? `-${table.from}-to-${table.to}` : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Reports (client design, set 1 screen 18): every business report in one
 * place. Each opens for any dates, downloads as CSV and prints to PDF from
 * the browser; the financial statements open their own screens.
 */
export default function ReportsPage() {
  const t = useT();
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(timeZone);
  const [tab, setTab] = useState<Tab>('operational');
  const [open, setOpen] = useState<ReportKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState<DateRange>(() => presetRange('month', today));
  const can = (p: string) => hasPermission(session, p);

  if (open) return <ReportView kind={open} range={range} today={today} onRange={setRange} onBack={() => setOpen(null)} />;

  return (
    <div className="list-screen" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('Reports')}</h1>
      <DayTabs
        label="Which reports"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setExporting(false);
        }}
        options={[
          { value: 'operational', label: 'Operational' },
          { value: 'financial', label: 'Financial' },
          { value: 'sales', label: 'Sales' },
        ]}
      />
      <div className="link-list">
        {ENTRIES[tab]
          .filter((e) => can(e.permission))
          .map((e) =>
            e.kind ? (
              <button key={e.label} type="button" className="link-row" onClick={() => setOpen(e.kind as ReportKind)}>
                <LinkRowBody entry={e} />
              </button>
            ) : e.href === '#export' ? (
              <button key={e.label} type="button" className="link-row" aria-expanded={exporting} onClick={() => setExporting((x) => !x)}>
                <LinkRowBody entry={e} />
              </button>
            ) : (
              <Link key={e.label} className="link-row" href={e.href ?? '#'}>
                <LinkRowBody entry={e} />
              </Link>
            ),
          )}
      </div>
      {exporting && (
        <div className="panel export-panel">
          <p className="muted">{t('Download each list as CSV — it opens in Excel or Google Sheets.')}</p>
          <div className="action-bar">
            {LISTS.filter((l) => can(l.permission)).map((l) => (
              <ExportButton key={l.kind} kind={l.kind} label={l.label} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LinkRowBody({ entry }: { entry: Entry }) {
  const t = useT();
  return (
    <>
      <span className="link-row-icon" aria-hidden="true">
        <Icon name={entry.icon} size={20} />
      </span>
      <span className="link-row-main">
        <span className="link-row-title">{t(entry.label)}</span>
        <span className="link-row-sub">{t(entry.description)}</span>
      </span>
      <Icon name="chevron" size={18} />
    </>
  );
}

/** A master list, fetched when asked for and downloaded straight away. */
function ExportButton({ kind, label }: { kind: ReportKind; label: string }) {
  const t = useT();
  const [asked, setAsked] = useState(false);
  const list = useReport(asked ? kind : null, '', '');
  useEffect(() => {
    if (asked && list.data?.kind === kind) {
      download(list.data);
      setAsked(false);
    }
  }, [asked, list.data, kind]);
  return (
    <button type="button" className="button" disabled={asked && list.isFetching} onClick={() => setAsked(true)}>
      <Icon name="download" size={16} /> {t(label)}
    </button>
  );
}

function ReportView({
  kind,
  range,
  today,
  onRange,
  onBack,
}: {
  kind: ReportKind;
  range: DateRange;
  today: string;
  onRange: (range: DateRange) => void;
  onBack: () => void;
}) {
  const t = useT();
  const currency = useCurrency();
  const report = useReport(kind, range.from, range.to);
  const table = report.data;
  return (
    <div className="stack report-view">
      <div className="report-head">
        <button type="button" className="icon-button no-print" onClick={onBack} aria-label={t('Back to reports')}>
          <Icon name="back" size={20} />
        </button>
        <h1 className="page-title">{t(table?.title ?? 'Report')}</h1>
      </div>
      <div className="report-toolbar">
        <RangeControls range={range} today={today} onChange={onRange} />
        <span className="print-only muted">
          {formatDate(range.from)} – {formatDate(range.to)}
        </span>
        <span className="report-actions no-print">
          <button type="button" className="button" disabled={!table} onClick={() => table && download(table)}>
            <Icon name="download" size={16} /> {t('Download CSV')}
          </button>
          <button type="button" className="button" disabled={!table} onClick={() => window.print()}>
            <Icon name="print" size={16} /> {t('Print / PDF')}
          </button>
        </span>
      </div>
      {report.isPending ? (
        <SkeletonLines lines={8} />
      ) : report.error || !table ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <div className="panel updating" data-updating={report.isPlaceholderData || undefined}>
          {table.truncated && <p className="action-note">{t('Only the first 5,000 rows are shown — choose fewer days for the rest.')}</p>}
          <div className="table-wrap">
            <table className="table report-table">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.key} className={c.kind === 'text' || c.kind === 'date' ? undefined : 'num'}>
                      {t(c.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={table.columns.length} className="muted">
                      {t('Nothing in these dates.')}
                    </td>
                  </tr>
                )}
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {table.columns.map((c) => (
                      <td key={c.key} className={c.kind === 'text' || c.kind === 'date' ? undefined : 'num'}>
                        {c.key === 'status' || c.key === 'type' || c.key === 'ownership' ? t(String(row[c.key] ?? '—')) : show(row[c.key], c, currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {table.totals && table.rows.length > 0 && (
                <tfoot>
                  <tr className="total-row">
                    {table.columns.map((c, i) => (
                      <td key={c.key} className={c.kind === 'text' || c.kind === 'date' ? undefined : 'num'}>
                        {i === 0 ? t('Total') : c.key in (table.totals ?? {}) ? show(table.totals?.[c.key] ?? null, c, currency) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="footnote">{t('{n} rows', { n: table.rows.length })}</p>
        </div>
      )}
    </div>
  );
}
