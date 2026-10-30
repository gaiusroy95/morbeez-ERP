// A customer's orders (requirements Part 14, AI Order Intelligence): what
// they usually take on a weekday, and an order far from it. Plain counting
// over their own past orders, so the owner can check it by hand.
import { Confidence } from './forecast';
import { median } from './anomaly';

/** One day's order from a customer: product → quantity. */
export type DayOrder = Map<string, number>;

export interface UsualLine {
  productId: string;
  /** The median of what they took — what to suggest. */
  quantity: number;
  low: number;
  high: number;
  /** On how many of those days they took it. */
  seen: number;
}

export interface UsualOrder {
  lines: UsualLine[];
  /** On how many of the weekdays looked at they ordered. */
  ordered: number;
  weeks: number;
  confidence: Confidence;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The customer's usual order for a weekday, from that weekday over the last
 * weeks (null where they didn't order). Expected when they ordered on most
 * of them — [minDays], 3 of 4 to start; each product they took on at least
 * half of those days (twice at least), at the median of what they took.
 * Solid when they ordered every week and took every product each time.
 */
export function usualOrder(days: (DayOrder | null)[], minDays = 3): UsualOrder | null {
  const ordered = days.filter((d): d is DayOrder => d !== null);
  if (ordered.length < minDays) return null;
  const taken = new Map<string, number[]>();
  for (const day of ordered) {
    for (const [productId, q] of day) if (q > 0) taken.set(productId, [...(taken.get(productId) ?? []), q]);
  }
  const lines: UsualLine[] = [...taken.entries()]
    .filter(([, qs]) => qs.length >= 2 && qs.length * 2 >= ordered.length)
    .map(([productId, qs]) => ({ productId, quantity: round3(median(qs)), low: Math.min(...qs), high: Math.max(...qs), seen: qs.length }))
    .sort((a, b) => b.quantity - a.quantity || a.productId.localeCompare(b.productId));
  if (!lines.length) return null;
  const every = ordered.length === days.length && lines.every((l) => l.seen === ordered.length);
  return { lines, ordered: ordered.length, weeks: days.length, confidence: every ? 'solid' : 'rough_guide' };
}

export interface QuantityFlag {
  productId: string;
  /** low: under half their least; high: over twice their most; missing: a product they took every time, not on it. */
  kind: 'low' | 'high' | 'missing';
  quantity: number;
  low: number;
  high: number;
  usual: number;
}

/**
 * An order far from what the customer takes on that weekday ("usually
 * 180–220 kg every Monday and has ordered only 60 kg"): judged only with
 * [minPast] past orders at least, against each product's least and most.
 */
export function unusualLines(order: DayOrder, past: DayOrder[], minPast = 3): QuantityFlag[] {
  if (past.length < minPast) return [];
  const flags: QuantityFlag[] = [];
  for (const [productId, quantity] of order) {
    const qs = past.map((d) => d.get(productId)).filter((q): q is number => q !== undefined && q > 0);
    if (qs.length < minPast) continue;
    const low = Math.min(...qs);
    const high = Math.max(...qs);
    const usual = round3(median(qs));
    if (quantity < low / 2) flags.push({ productId, kind: 'low', quantity, low, high, usual });
    else if (quantity > high * 2) flags.push({ productId, kind: 'high', quantity, low, high, usual });
  }
  const always = [...(past[0]?.keys() ?? [])].filter((p) => past.every((d) => (d.get(p) ?? 0) > 0) && !order.has(p));
  for (const productId of always) {
    const qs = past.map((d) => d.get(productId)!);
    flags.push({ productId, kind: 'missing', quantity: 0, low: Math.min(...qs), high: Math.max(...qs), usual: round3(median(qs)) });
  }
  return flags;
}
