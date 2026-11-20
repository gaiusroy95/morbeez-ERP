import { fromCents, toCents } from '../../common/money';
import { fromMilli } from '../../common/quantity';

// The cost allocation arithmetic (Master Spec v3 P5, rules C1–C6), kept pure
// so every rounding decision is unit-tested. Money in paise, weights in
// thousandths of a kg, all as bigint — never a float (Constitution III.2).

export const RUNNING_COMPONENTS = ['fuel', 'tolls', 'repairs', 'driverIncentives', 'otherExpenses', 'vehicle'] as const;
export const LOAD_COMPONENTS = ['labour', 'helperIncentives', 'writtenOff'] as const;
export const COMPONENTS = [...RUNNING_COMPONENTS, ...LOAD_COMPONENTS] as const;
export type CostComponent = (typeof COMPONENTS)[number];
export type Components = Record<CostComponent, bigint>;

export const zeroComponents = (): Components => Object.fromEntries(COMPONENTS.map((c) => [c, 0n])) as Components;
export const sumOf = (c: Components, which: readonly CostComponent[] = COMPONENTS): bigint => which.reduce((s, k) => s + c[k], 0n);

/** Service minutes count only when the phone stamped both, completion after arrival, within 3 hours (rule C2). */
export const MAX_SERVICE_MINUTES = 180;
/** A customer's service time shares the running pool once they have this much history (D1). */
export const SERVICE_HISTORY_DAYS = 30;

export function verifiedServiceMinutes(arrivedAt: Date | null, completedAt: Date | null): number | null {
  if (!arrivedAt || !completedAt) return null;
  const minutes = Math.round((completedAt.getTime() - arrivedAt.getTime()) / 60_000);
  return minutes > 0 && minutes <= MAX_SERVICE_MINUTES ? minutes : null;
}

/**
 * `amount` split in proportion to `weights`, half-way paise to the largest
 * remainders (ties to the earlier entry), so the parts add up to it exactly.
 * All-zero weights split it equally; no weights at all returns null — there
 * is nothing to carry it.
 */
export function largestRemainder(amount: bigint, weights: bigint[]): bigint[] | null {
  if (weights.length === 0) return null;
  if (weights.some((w) => w < 0n)) throw new Error('A weight below zero');
  const total = weights.reduce((s, w) => s + w, 0n);
  const ws = total === 0n ? weights.map(() => 1n) : weights;
  const t = total === 0n ? BigInt(weights.length) : total;
  const parts = ws.map((w) => (amount * w) / t);
  let left = amount - parts.reduce((s, p) => s + p, 0n);
  const order = ws.map((w, i) => ({ i, rem: (amount * w) % t })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i] += 1n;
    left -= 1n;
  }
  return parts;
}

/** A line a stop carries: an order line delivered, or a lot picked up. */
export interface TargetLine {
  key: string;
  kind: 'order_line' | 'lot';
  productId: string;
  /** KG-equivalent in thousandths (rule C4); null when the product has no weight. */
  kgMilli: bigint | null;
  /** Its value in paise — how a stop with no weight splits its share between its lines. */
  valueCents: bigint;
}

export interface CostStop {
  stopId: string;
  kind: 'delivery' | 'pickup';
  customerId: string | null;
  serviceMinutes: number | null;
  /** The customer has SERVICE_HISTORY_DAYS of verified service time before this trip (D1). */
  customerHasHistory: boolean;
  lines: TargetLine[];
}

export interface AllocationRow {
  key: string;
  kind: 'order_line' | 'lot';
  stopId: string;
  customerId: string | null;
  productId: string;
  kgMilli: bigint;
  serviceMinutes: number | null;
  components: Components;
}

export interface TripAllocation {
  rows: AllocationRow[];
  /** What no stop could carry, per component. */
  unallocated: Components;
  unallocatedReason: string | null;
  deliveredKgMilli: bigint;
  pickupKgMilli: bigint;
  unweightedLines: number;
}

const kgOf = (lines: TargetLine[]) => lines.reduce((s, l) => s + (l.kgMilli ?? 0n), 0n);

/**
 * The running pool's key per stop (D1): α% by KG, the rest by verified
 * service minutes — but a stop whose customer lacks the history (or a pickup,
 * which has no customer) takes its KG share for that part too. As integers:
 *   W(i) = α·kg(i)·M + (100−α)·(i in Q ? m(i)·K : kg(i)·M)
 * where Q is the stops with history and minutes, M their minutes and K their
 * kg; the non-Q stops end up with exactly their KG share, and Q shares its own
 * KG total out by minutes. All-zero KG and no minutes: equal per stop.
 */
export function runningKeys(stops: CostStop[], kgSharePct: bigint): bigint[] {
  if (kgSharePct < 0n || kgSharePct > 10_000n) throw new Error('The KG share is a percentage in hundredths, 0–10000');
  const kg = stops.map((s) => kgOf(s.lines));
  const inQ = stops.map((s) => s.kind === 'delivery' && s.customerHasHistory && s.serviceMinutes !== null && s.serviceMinutes > 0);
  const m = stops.map((s, i) => (inQ[i] ? BigInt(s.serviceMinutes as number) : 0n));
  const M = m.reduce((a, b) => a + b, 0n);
  const K = kg.reduce((a, b, i) => (inQ[i] ? a + b : a), 0n);
  if (M === 0n) return kg; // no service part anywhere: KG alone (all zero → equal, in largestRemainder)
  const rest = 10_000n - kgSharePct;
  const keys = stops.map((_, i) => kgSharePct * kg[i] * M + rest * (inQ[i] ? m[i] * K : kg[i] * M));
  // Q stops carried no KG at all: their service part has nothing to share — fall back to minutes alone for them.
  if (K === 0n && keys.every((k) => k === 0n)) return m;
  return keys;
}

/** A stop's share split to its lines: by KG, else (no weight on any line) by value, else equally. */
function toLines(amount: bigint, lines: TargetLine[]): bigint[] {
  const byKg = lines.map((l) => l.kgMilli ?? 0n);
  if (byKg.some((w) => w > 0n)) return largestRemainder(amount, byKg) as bigint[];
  return largestRemainder(amount, lines.map((l) => l.valueCents)) as bigint[];
}

/**
 * Shares a trip's cost out to the stops that carried it (rules C2–C4).
 * Running components go to every stop in scope — deliveries with something
 * delivered (or with verified service time for a customer with history) and
 * pickups with lots — by `runningKeys`; load components go to the delivered
 * lines by KG, or, with no deliveries, to the lots picked up. Each component
 * is split on its own by largest remainder, so each adds up exactly; what has
 * nowhere to go stays unallocated, with the reason.
 */
export function allocateTrip(pools: Components, stops: CostStop[], kgSharePct: bigint): TripAllocation {
  const delivered = (s: CostStop) => s.kind === 'delivery' && s.lines.some((l) => l.kgMilli === null || l.kgMilli > 0n || l.valueCents > 0n);
  const inScope = stops.filter(
    (s) =>
      s.lines.length > 0 &&
      (s.kind === 'pickup' ? true : delivered(s) || (s.customerHasHistory && s.serviceMinutes !== null && s.serviceMinutes > 0)),
  );
  const rows = new Map<string, AllocationRow>();
  for (const s of inScope) {
    for (const l of s.lines) {
      rows.set(l.key, {
        key: l.key,
        kind: l.kind,
        stopId: s.stopId,
        customerId: s.customerId,
        productId: l.productId,
        kgMilli: l.kgMilli ?? 0n,
        serviceMinutes: s.serviceMinutes,
        components: zeroComponents(),
      });
    }
  }
  const unallocated = zeroComponents();
  const reasons = new Set<string>();

  const keys = runningKeys(inScope, kgSharePct);
  for (const c of RUNNING_COMPONENTS) {
    if (pools[c] === 0n) continue;
    const perStop = largestRemainder(pools[c], keys);
    if (!perStop) {
      unallocated[c] += pools[c];
      reasons.add('No delivery or pickup on the trip to carry its running costs');
      continue;
    }
    inScope.forEach((s, i) => toLines(perStop[i], s.lines).forEach((v, j) => (rows.get(s.lines[j].key) as AllocationRow).components[c] += v));
  }

  const deliveredLines = inScope.filter((s) => s.kind === 'delivery').flatMap((s) => s.lines);
  const pickupLines = inScope.filter((s) => s.kind === 'pickup').flatMap((s) => s.lines);
  const loadTargets = deliveredLines.length > 0 ? deliveredLines : pickupLines;
  for (const c of LOAD_COMPONENTS) {
    if (pools[c] === 0n) continue;
    if (loadTargets.length === 0) {
      unallocated[c] += pools[c];
      reasons.add('Nothing delivered or picked up on the trip to carry its loading costs and write-offs');
      continue;
    }
    toLines(pools[c], loadTargets).forEach((v, j) => (rows.get(loadTargets[j].key) as AllocationRow).components[c] += v);
  }

  const allLines = stops.flatMap((s) => s.lines);
  return {
    rows: [...rows.values()],
    unallocated,
    unallocatedReason: reasons.size > 0 ? [...reasons].join('; ') : null,
    deliveredKgMilli: stops.filter((s) => s.kind === 'delivery').reduce((t, s) => t + kgOf(s.lines), 0n),
    pickupKgMilli: stops.filter((s) => s.kind === 'pickup').reduce((t, s) => t + kgOf(s.lines), 0n),
    unweightedLines: allLines.filter((l) => l.kgMilli === null).length,
  };
}

/**
 * The vehicle's share of a trip (rule C1): its km × the vehicle's cost per km
 * over the window — fixed costs in the window over the km driven on its
 * closed trips in it — half-up to the paisa. Km in tenths, as recorded.
 */
export function vehicleShare(fixedCostsCents: bigint, windowKmTenths: bigint, tripKmTenths: bigint): { share: bigint; ratePerKm: string | null } {
  if (windowKmTenths <= 0n || tripKmTenths <= 0n || fixedCostsCents <= 0n) {
    return { share: 0n, ratePerKm: windowKmTenths > 0n && fixedCostsCents > 0n ? perKm(fixedCostsCents, windowKmTenths) : null };
  }
  const share = (fixedCostsCents * tripKmTenths * 2n + windowKmTenths) / (windowKmTenths * 2n);
  return { share, ratePerKm: perKm(fixedCostsCents, windowKmTenths) };
}

/** ₹ per km to 4 dp: paise × 10 ÷ tenths of a km, as rupees. */
function perKm(cents: bigint, kmTenths: bigint): string {
  const tenThousandths = (cents * 10n * 100n * 2n + kmTenths) / (kmTenths * 2n); // ₹ × 10^4 per km
  const whole = tenThousandths / 10_000n;
  return `${whole}.${(tenThousandths % 10_000n).toString().padStart(4, '0')}`;
}

/** ₹ per KG to 4 dp, or null without KG. */
export function perKg(cents: bigint, kgMilli: bigint): string | null {
  if (kgMilli <= 0n) return null;
  const negative = cents < 0n;
  const c = negative ? -cents : cents;
  const q = (c * 100n * 1000n * 2n + kgMilli) / (kgMilli * 2n); // ₹ × 10^4 per kg
  return `${negative ? '-' : ''}${q / 10_000n}.${(q % 10_000n).toString().padStart(4, '0')}`;
}

/** The difference of two 4-dp rates, exactly. */
export function rateDifference(a: string, b: string): string {
  const x = (v: string) => {
    const neg = v.startsWith('-');
    const [w, f = ''] = v.replace('-', '').split('.');
    const n = BigInt(w) * 10_000n + BigInt((f + '0000').slice(0, 4));
    return neg ? -n : n;
  };
  const d = x(a) - x(b);
  const neg = d < 0n;
  const abs = neg ? -d : d;
  return `${neg ? '-' : ''}${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, '0')}`;
}

/**
 * Rupee-days a customer kept the business waiting (MS §31; rule C6): what
 * was owed on an invoice, day by day, from its issue until it was settled or
 * `until` — each payment, credit note or write-off lowering it from the day
 * it landed. Paise × days.
 */
export function rupeeDays(input: { amountCents: bigint; issuedOn: string; reductions: { on: string; cents: bigint }[] }, until: string): bigint {
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const end = day(until);
  let at = day(input.issuedOn);
  if (end <= at) return 0n;
  let owed = input.amountCents;
  let total = 0n;
  const events = [...input.reductions].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  for (const e of events) {
    const on = Math.min(Math.max(day(e.on), at), end);
    if (owed > 0n) total += owed * BigInt(on - at);
    at = on;
    owed -= e.cents;
    if (owed < 0n) owed = 0n;
  }
  if (owed > 0n) total += owed * BigInt(end - at);
  return total;
}

/** Finance cost of rupee-days at an annual rate: paise × days × rate% ÷ 365, half-up. */
export function financeCostOf(paiseDays: bigint, ratePercentAnnual: string): bigint {
  const bp = toCents(ratePercentAnnual); // 18.00% → 1800
  if (paiseDays <= 0n || bp <= 0n) return 0n;
  const denominator = 10_000n * 365n;
  return (paiseDays * bp * 2n + denominator) / (denominator * 2n);
}

export const cents = (v: string): bigint => toCents(v);
export const rupees = (v: bigint): string => fromCents(v);
export const kgText = (milli: bigint): string => fromMilli(milli);
