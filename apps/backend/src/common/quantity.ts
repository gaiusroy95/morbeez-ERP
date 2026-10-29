// Exact arithmetic on 3-dp quantity strings via integer thousandths — the
// scale the schema stores kilos and pieces at (numeric(12,3)), never a
// float round trip (Constitution III.2).

import { fromCents, toCents } from './money';

/** Quantity with up to 3 dp → thousandths. */
export function toMilli(q: string): bigint {
  const negative = q.startsWith('-');
  const [w, f = ''] = (negative ? q.slice(1) : q).split('.');
  const m = BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3));
  return negative ? -m : m;
}

export function fromMilli(m: bigint): string {
  const sign = m < 0n ? '-' : '';
  const abs = m < 0n ? -m : m;
  return `${sign}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}

export const minMilli = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Σ quantity × unit cost over draws, rounded half-up to the paisa once at the end. */
export function costOfDraws(draws: { quantity: string; unitCost: string | null }[]): string | null {
  const costed = draws.filter((d) => d.unitCost !== null);
  if (costed.length === 0) return null;
  const total = costed.reduce((n, d) => n + toMilli(d.quantity) * toCents(d.unitCost as string), 0n); // paise × thousandths
  return fromCents((total * 2n + 1000n) / 2000n);
}
