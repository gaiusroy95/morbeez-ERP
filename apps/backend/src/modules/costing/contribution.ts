import { fromCents, toCents } from '../../common/money';
import { toMilli } from '../../common/quantity';
import { ContributionLevel, ContributionRow } from './costing.entity';
import { ExtraCostRow, LineFactRow } from './costing.repository';
import { largestRemainder, perKg } from './costing-math';

// The contribution hierarchy (MS §35: Business → Route → Trip → Vehicle →
// Product → Customer → Order; rule C6), kept pure: every level is built from
// the same sold lines and the same unattached costs, so every level adds up
// to the business total — paisa for paisa.

interface Figures {
  kg: bigint;
  revenue: bigint;
  purchase: bigint;
  agent: bigint;
  labour: bigint;
  fuel: bigint;
  tolls: bigint;
  delivery: bigint;
  writtenOff: bigint;
  other: bigint;
  finance: bigint;
}

const zero = (): Figures => ({ kg: 0n, revenue: 0n, purchase: 0n, agent: 0n, labour: 0n, fuel: 0n, tolls: 0n, delivery: 0n, writtenOff: 0n, other: 0n, finance: 0n });

function add(a: Figures, b: Figures): void {
  for (const k of Object.keys(a) as (keyof Figures)[]) a[k] += b[k];
}

const c = (v: string) => toCents(v);

function lineFigures(l: LineFactRow, finance: bigint): Figures {
  return {
    kg: toMilli(l.kg),
    revenue: c(l.revenue),
    purchase: c(l.purchase),
    agent: c(l.agent),
    labour: c(l.labour) + c(l.helper_incentives) + c(l.driver_incentives),
    fuel: c(l.fuel),
    tolls: c(l.tolls),
    delivery: c(l.vehicle) + c(l.repairs),
    writtenOff: c(l.written_off),
    other: c(l.other_expenses),
    finance,
  };
}

function extraFigures(x: ExtraCostRow): Figures {
  return { ...zero(), kg: 0n, writtenOff: c(x.written_off), other: c(x.other_expenses) };
}

/** A key and label for a sold line, at a level. */
function lineKey(level: ContributionLevel, l: LineFactRow): { key: string | null; label: string } {
  switch (level) {
    case 'business':
      return { key: 'business', label: 'Business' };
    case 'route':
      return l.route_id ? { key: l.route_id, label: l.route_name ?? 'Route' } : { key: null, label: 'No route' };
    case 'trip':
      return l.trip_id ? { key: l.trip_id, label: l.trip_number ?? 'Trip' } : { key: null, label: 'Not costed yet' };
    case 'vehicle':
      return l.vehicle_id ? { key: l.vehicle_id, label: l.vehicle_registration ?? 'Vehicle' } : { key: null, label: 'Not costed yet' };
    case 'product':
      return { key: l.product_id, label: l.product_name };
    case 'customer':
      return { key: l.customer_id, label: l.customer_name };
    case 'order':
      return { key: l.order_id, label: `${l.order_number}` };
  }
}

/** Where a cost no sold line carries sits, at a level — or the "not attributable" row. */
function extraKey(level: ContributionLevel, x: ExtraCostRow): { key: string | null; label: string } {
  const none = { key: null, label: 'Not attributable at this level' };
  switch (level) {
    case 'business':
      return { key: 'business', label: 'Business' };
    case 'route':
      return x.route_id ? { key: x.route_id, label: x.route_name ?? 'Route' } : x.trip_id ? { key: null, label: 'No route' } : none;
    case 'trip':
      return x.trip_id ? { key: x.trip_id, label: x.trip_number ?? 'Trip' } : none;
    case 'vehicle':
      return x.vehicle_id ? { key: x.vehicle_id, label: x.vehicle_registration ?? 'Vehicle' } : none;
    case 'product':
      return x.product_id ? { key: x.product_id, label: x.product_name ?? 'Product' } : none;
    case 'customer':
    case 'order':
      return none;
  }
}

function toRow(key: string | null, label: string, f: Figures): ContributionRow {
  const trueCost = f.purchase + f.agent + f.labour + f.fuel + f.tolls + f.delivery + f.writtenOff + f.other;
  const operating = f.revenue - trueCost;
  const net = operating - f.finance;
  return {
    key,
    label,
    kg: `${f.kg / 1000n}.${(f.kg % 1000n).toString().padStart(3, '0')}`,
    revenue: fromCents(f.revenue),
    purchase: fromCents(f.purchase),
    agent: fromCents(f.agent),
    labour: fromCents(f.labour),
    fuel: fromCents(f.fuel),
    tolls: fromCents(f.tolls),
    delivery: fromCents(f.delivery),
    writtenOff: fromCents(f.writtenOff),
    other: fromCents(f.other),
    trueCost: fromCents(trueCost),
    operatingContribution: fromCents(operating),
    financeCost: fromCents(f.finance),
    netContribution: fromCents(net),
    revenuePerKg: perKg(f.revenue, f.kg),
    trueCostPerKg: perKg(trueCost, f.kg),
    contributionPerKg: perKg(operating, f.kg),
    netMarginPct: f.revenue > 0n ? Math.round(Number((net * 10_000n) / f.revenue)) / 100 : null,
  };
}

/**
 * Each invoice's finance cost spread over its lines in the period by
 * revenue (largest remainder; lines credited to nothing share equally).
 */
export function financeByLine(lines: LineFactRow[], financeByInvoice: Map<string, bigint>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const byInvoice = new Map<string, LineFactRow[]>();
  for (const l of lines) byInvoice.set(l.invoice_id, [...(byInvoice.get(l.invoice_id) ?? []), l]);
  for (const [invoiceId, ls] of byInvoice) {
    const cost = financeByInvoice.get(invoiceId) ?? 0n;
    const parts = largestRemainder(cost, ls.map((l) => (c(l.revenue) > 0n ? c(l.revenue) : 0n))) as bigint[];
    ls.forEach((l, i) => out.set(l.invoice_line_id, parts[i]));
  }
  return out;
}

/** The hierarchy at one level: a row a key, the unattributable row last, and the totals. */
export function contributionAt(
  level: ContributionLevel,
  lines: LineFactRow[],
  extras: ExtraCostRow[],
  financeLine: Map<string, bigint>,
): { rows: ContributionRow[]; totals: ContributionRow } {
  const groups = new Map<string, { key: string | null; label: string; f: Figures }>();
  const into = (k: { key: string | null; label: string }, f: Figures) => {
    const id = k.key ?? `none:${k.label}`;
    const g = groups.get(id) ?? { key: k.key, label: k.label, f: zero() };
    add(g.f, f);
    groups.set(id, g);
  };
  const total = zero();
  for (const l of lines) {
    const f = lineFigures(l, financeLine.get(l.invoice_line_id) ?? 0n);
    into(lineKey(level, l), f);
    add(total, f);
  }
  for (const x of extras) {
    const f = extraFigures(x);
    into(extraKey(level, x), f);
    add(total, f);
  }
  // Biggest revenue first; the rows with no key (not attributable, not costed) last.
  const rows = [...groups.values()]
    .map((g) => toRow(g.key, g.label, g.f))
    .sort((a, b) => {
      const unkeyed = (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0);
      if (unkeyed !== 0) return unkeyed;
      const d = toCents(b.revenue) - toCents(a.revenue);
      return d > 0n ? 1 : d < 0n ? -1 : a.label.localeCompare(b.label);
    });
  return { rows, totals: toRow('total', 'Total', total) };
}
