// Spot-sale arithmetic, pure: which price band a line is judged by, whether
// its price is an exception (and how big — what an approver's limit is
// checked against), and which of the vehicle's lots a quantity comes from.
// Money in paise, quantities in thousandths, never floats.

import { fromCents, toCents } from '../../common/money';

export type BandSource = 'band' | 'default' | 'none';
export type PriceException = 'below_band' | 'above_band' | 'no_band' | 'below_cost';

export interface Band {
  source: BandSource;
  min: string | null;
  max: string | null;
}

/** Percent with up to 2 dp ("12.5") → basis points. */
function bps(rate: string): bigint {
  const [w, f = ''] = rate.split('.');
  return BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
}

const halfUp = (num: bigint, den: bigint) => (num * 2n + den) / (den * 2n);

/** Quantity with up to 3 dp → thousandths. */
export function toMilli(q: string): bigint {
  const [w, f = ''] = q.split('.');
  return BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3));
}

export function fromMilli(m: bigint): string {
  return `${m / 1000n}.${(m % 1000n).toString().padStart(3, '0')}`;
}

/** quantity × unit price, half-up to the paisa. */
export function lineValue(quantity: string, unitPrice: string): string {
  return fromCents(halfUp(toMilli(quantity) * toCents(unitPrice), 1000n));
}

/**
 * The product's own band in force; otherwise the tenant's default either
 * side of its base price; otherwise none (every price then needs approval).
 */
export function resolveBand(
  own: { minPrice: string; maxPrice: string | null } | null,
  basePrice: string | null,
  defaults: { floorPct: string; ceilingPct: string },
): Band {
  if (own) return { source: 'band', min: own.minPrice, max: own.maxPrice };
  if (basePrice && toCents(basePrice) > 0n) {
    const base = toCents(basePrice);
    return {
      source: 'default',
      min: fromCents(halfUp(base * (10_000n - bps(defaults.floorPct)), 10_000n)),
      max: fromCents(halfUp(base * (10_000n + bps(defaults.ceilingPct)), 10_000n)),
    };
  }
  return { source: 'none', min: null, max: null };
}

/**
 * Whether a line needs approval, and its size — the money the price is off
 * by across the quantity: under the floor, over the ceiling, or under what
 * the stock cost. The largest applies; a line with no band at all counts
 * its whole value.
 */
export function judgeLine(
  line: { quantity: string; unitPrice: string },
  band: Band,
  unitCost: string | null,
): { exception: PriceException | null; value: string } {
  const q = line.quantity;
  if (band.source === 'none') return { exception: 'no_band', value: lineValue(q, line.unitPrice) };
  const price = toCents(line.unitPrice);
  const candidates: { exception: PriceException; cents: bigint }[] = [];
  if (band.min !== null && price < toCents(band.min)) candidates.push({ exception: 'below_band', cents: toCents(lineValue(q, fromCents(toCents(band.min) - price))) });
  if (band.max !== null && price > toCents(band.max)) candidates.push({ exception: 'above_band', cents: toCents(lineValue(q, fromCents(price - toCents(band.max)))) });
  if (unitCost !== null && price < toCents(unitCost)) candidates.push({ exception: 'below_cost', cents: toCents(lineValue(q, fromCents(toCents(unitCost) - price))) });
  const worst = candidates.filter((c) => c.cents > 0n).sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0))[0];
  return worst ? { exception: worst.exception, value: fromCents(worst.cents) } : { exception: null, value: '0.00' };
}

export interface VehicleLot {
  lotId: string;
  quantity: string; // what's left in it
  unitCost: string;
  receivedAt: string; // ISO — oldest goes first
}

/**
 * Which lots a quantity comes from: oldest received first, whole lots
 * before the next is touched. Null when the vehicle doesn't hold enough.
 */
export function planDraw(lots: VehicleLot[], quantity: string): { draws: { lotId: string; quantity: string; unitCost: string }[]; cost: string } | null {
  let left = toMilli(quantity);
  const draws: { lotId: string; quantity: string; unitCost: string }[] = [];
  let costNum = 0n; // paise × thousandths
  for (const lot of [...lots].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0))) {
    if (left === 0n) break;
    const have = toMilli(lot.quantity);
    if (have <= 0n) continue;
    const take = have < left ? have : left;
    draws.push({ lotId: lot.lotId, quantity: fromMilli(take), unitCost: lot.unitCost });
    costNum += take * toCents(lot.unitCost);
    left -= take;
  }
  if (left > 0n) return null;
  return { draws, cost: fromCents(halfUp(costNum, 1000n)) };
}

/** The weighted cost per unit of a draw — for judging a price against cost. */
export function unitCostOf(cost: string, quantity: string): string {
  return fromCents(halfUp(toCents(cost) * 1000n, toMilli(quantity)));
}
