import { fromCents, toCents } from '../../common/money';

// The finance engine's arithmetic, kept pure so every rounding decision is
// unit-tested rather than buried in a service. All money in and out is a
// 2-dp decimal string (Constitution III.2).

export interface OpenItem {
  id: string;
  outstanding: string;
}

export interface Allocation {
  id: string;
  amount: string;
}

/**
 * Applies `amount` to `items` in the order given (callers pass them oldest
 * due first), each up to its outstanding balance. Returns the allocations
 * made and whatever couldn't be applied.
 */
export function allocateInOrder(amount: string, items: OpenItem[]): { allocations: Allocation[]; remainder: string } {
  let left = toCents(amount);
  const allocations: Allocation[] = [];
  for (const item of items) {
    if (left <= 0n) break;
    const open = toCents(item.outstanding);
    if (open <= 0n) continue;
    const take = open < left ? open : left;
    allocations.push({ id: item.id, amount: fromCents(take) });
    left -= take;
  }
  return { allocations, remainder: fromCents(left) };
}

/**
 * Simple interest for `days` at `ratePercentPer30Days` on `principal`:
 * principal × rate/100 × days/30, rounded half-up to the paisa. Computed in
 * integer paise × basis points, so no step goes through a float.
 */
export function financeChargeAmount(principal: string, ratePercentPer30Days: string, days: number): string {
  if (!Number.isInteger(days) || days <= 0) return '0.00';
  const principalCents = toCents(principal);
  const rateBasisPoints = toCents(ratePercentPer30Days); // "1.50" % → 150 basis points
  if (principalCents <= 0n || rateBasisPoints <= 0n) return '0.00';
  // cents × bp × days / (10_000 bp-per-unit × 30 days), rounded half-up.
  const numerator = principalCents * rateBasisPoints * BigInt(days);
  const denominator = 10_000n * 30n;
  return fromCents((numerator * 2n + denominator) / (denominator * 2n));
}

/** Whole calendar days from `from` to `to` (YYYY-MM-DD), negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** YYYY-MM-DD plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The later of two YYYY-MM-DD dates. */
export function laterDate(a: string, b: string): string {
  return a >= b ? a : b;
}
