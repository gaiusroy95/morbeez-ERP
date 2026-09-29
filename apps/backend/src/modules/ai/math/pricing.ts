// Price suggestion (AI System REC table): cost of the stock on hand plus the
// tenant's target margin, kept inside the prices actually realized lately,
// never below cost, and moved at most a set step from today's price.
// Money in paise throughout (Constitution III.2).

import { fromCents, toCents } from '../../../common/money';

export interface PriceInputs {
  unitCost: string; // weighted cost of the free lots
  basePrice: string; // today's list price
  realized: { low: string; high: string; average: string; lines: number } | null; // last 14 days
  targetMarginPct: string;
  maxMovePct: string;
}

export interface PriceSuggestion {
  price: string;
  bandMin: string;
  bandMax: string;
  reason: 'below_cost' | 'margin' | 'market';
  movePct: number; // vs today's price
  steps: string[]; // how it was reached, for the evidence
}

const bps = (pct: string) => BigInt(Math.round(Number(pct) * 100));
const pctOf = (cents: bigint, basisPoints: bigint) => (cents * basisPoints + 5_000n) / 10_000n;
/** Nearest 50 paise — prices per kg are quoted in halves of a rupee. */
const toHalfRupee = (cents: bigint) => ((cents + 25n) / 50n) * 50n;
const clamp = (x: bigint, lo: bigint, hi: bigint) => (x < lo ? lo : x > hi ? hi : x);

export function suggestPrice(p: PriceInputs): PriceSuggestion {
  const cost = toCents(p.unitCost);
  const base = toCents(p.basePrice);
  const steps: string[] = [];
  let target = cost + pctOf(cost, bps(p.targetMarginPct));
  steps.push(`cost ${fromCents(cost)} + ${p.targetMarginPct}% target margin = ${fromCents(target)}`);
  let reason: PriceSuggestion['reason'] = 'margin';

  if (p.realized && p.realized.lines >= 3) {
    const lo = toCents(p.realized.low);
    const hi = toCents(p.realized.high);
    const kept = clamp(target, lo, hi);
    if (kept !== target) {
      steps.push(`kept inside the last 14 days' prices ${fromCents(lo)}–${fromCents(hi)}: ${fromCents(kept)}`);
      target = kept;
      reason = 'market';
    }
  }
  if (base > 0n) {
    const step = pctOf(base, bps(p.maxMovePct));
    const moved = clamp(target, base - step, base + step);
    if (moved !== target) {
      steps.push(`limited to a ${p.maxMovePct}% step from today's ${fromCents(base)}: ${fromCents(moved)}`);
      target = moved;
    }
  }
  if (target < cost) {
    steps.push(`raised to cost ${fromCents(cost)} — never suggested below it`);
    target = cost;
    reason = 'below_cost';
  }
  if (base > 0n && base < cost) reason = 'below_cost';
  let price = toHalfRupee(target);
  if (price < cost) price += 50n;
  const bandMin = (() => {
    const m = toHalfRupee(price - pctOf(price, 1_000n));
    return m < cost ? toHalfRupee(cost + 25n) : m;
  })();
  const bandMax = toHalfRupee(price + pctOf(price, 2_000n));
  const movePct = base > 0n ? Math.round(Number(((price - base) * 10_000n) / base)) / 100 : 0;
  return { price: fromCents(price), bandMin: fromCents(bandMin), bandMax: fromCents(bandMax), reason, movePct, steps };
}

/** Worth suggesting: the move is at least ₹0.50 and 2%, or today's price is below cost. */
export function worthSuggesting(s: PriceSuggestion, basePrice: string): boolean {
  if (s.reason === 'below_cost' && toCents(basePrice) < toCents(s.price)) return true;
  const diff = toCents(s.price) - toCents(basePrice);
  const abs = diff < 0n ? -diff : diff;
  return abs >= 50n && Math.abs(s.movePct) >= 2;
}
