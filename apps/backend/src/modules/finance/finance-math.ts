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
 * The pilot formula (client Q&A, finance): outstanding principal × annual
 * rate × overdue days ÷ 365, rounded half-up to the paisa — in integer paise
 * × basis points, so no step goes through a float. Partial payments lower
 * the principal at once (the caller passes what's outstanding now).
 */
export function financeChargeAnnual(principal: string, ratePercentAnnual: string, days: number): string {
  if (!Number.isInteger(days) || days <= 0) return '0.00';
  const principalCents = toCents(principal);
  const rateBasisPoints = toCents(ratePercentAnnual); // "18.00" % → 1800 basis points
  if (principalCents <= 0n || rateBasisPoints <= 0n) return '0.00';
  const numerator = principalCents * rateBasisPoints * BigInt(days);
  const denominator = 10_000n * 365n;
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
