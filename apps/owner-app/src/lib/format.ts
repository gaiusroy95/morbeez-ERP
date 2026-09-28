// Presentation only. Money arrives as decimal strings computed in SQL
// (Constitution III.2); converting to a number here is only ever for
// display or a display-only ratio, never for a figure that's stored or
// summed further.

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const compactFormatters = new Map<string, Intl.NumberFormat>();

// en-IN groups by lakh and crore (12,34,567.00) — how these users read money.
function moneyFormatter(currency: string): Intl.NumberFormat {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 });
    moneyFormatters.set(currency, formatter);
  }
  return formatter;
}

function compactFormatter(currency: string): Intl.NumberFormat {
  let formatter = compactFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    compactFormatters.set(currency, formatter);
  }
  return formatter;
}

export function formatMoney(value: string, currency: string): string {
  return moneyFormatter(currency).format(Number(value));
}

export function formatMoneyCompact(value: string, currency: string): string {
  return compactFormatter(currency).format(Number(value));
}

const countFormatter = new Intl.NumberFormat('en-IN');
export function formatCount(value: string | number): string {
  return countFormatter.format(Number(value));
}

export interface Delta {
  direction: 'up' | 'down' | 'flat';
  label: string;
}

/** Change against the previous period, or null when there's nothing meaningful to compare. */
export function computeDelta(value: string, previous: string | null): Delta | null {
  if (previous === null) return null;
  const current = Number(value);
  const prior = Number(previous);
  if (prior === 0) {
    return current === 0 ? { direction: 'flat', label: 'No change' } : { direction: 'up', label: 'New this period' };
  }
  const percent = ((current - prior) / Math.abs(prior)) * 100;
  if (Math.abs(percent) < 0.5) return { direction: 'flat', label: 'No change' };
  return {
    direction: percent > 0 ? 'up' : 'down',
    label: `${percent > 0 ? '+' : '−'}${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`,
  };
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** YYYY-MM-DD (already tenant-local) → "7 Sept 2026". Parsed as UTC so the date never shifts. */
export function formatDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
/** An instant → "26 Sept, 2:30 pm", in the tenant's timezone rather than the browser's. */
export function formatDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(iso));
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** An instant → "26 Sept 2026", the calendar day it fell on in the tenant's timezone. */
export function formatDay(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(iso));
}

const quantityFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
/** "1,250.5 kg" — quantities are 3-dp decimal strings. */
export function formatQuantity(value: string | null, uom?: string): string {
  if (value === null) return '—';
  const text = quantityFormatter.format(Number(value));
  return uom && !uom.startsWith('#') ? `${text} ${uom}` : text;
}

/** Whole days between an instant and now — for "in stock 4 days". */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const amountFormatter = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/**
 * Statement style: 2 dp, lakh grouping, no currency symbol (the statement
 * says the currency once), negatives in parentheses — (1,250.00).
 */
export function formatAmount(value: string): string {
  const n = Number(value);
  const text = amountFormatter.format(Math.abs(n));
  return n < 0 ? `(${text})` : text;
}
