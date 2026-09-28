// Exact decimal arithmetic on 2-dp money strings via integer paise — never
// a float round trip (Constitution III.2). For totals that are cheaper to
// derive in the service than to query again; aggregation over rows still
// belongs in SQL.

export function subtractMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

export function sumMoney(values: string[]): string {
  return fromCents(values.reduce((total, value) => total + toCents(value), 0n));
}

/** -1, 0, or 1 — exact, unlike comparing Number(a) with Number(b). */
export function compareMoney(a: string, b: string): number {
  const diff = toCents(a) - toCents(b);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}

export function minMoney(a: string, b: string): string {
  return compareMoney(a, b) <= 0 ? normalizeMoney(a) : normalizeMoney(b);
}

export function isPositiveMoney(value: string): boolean {
  return toCents(value) > 0n;
}

/** "5" → "5.00", "1.5" → "1.50". Input beyond 2 dp is truncated, so validate precision before calling. */
export function normalizeMoney(value: string): string {
  return fromCents(toCents(value));
}

/** A number with at most 2 dp (a validated DTO field) → its exact money string. */
export function moneyFromNumber(value: number): string {
  return normalizeMoney(value.toFixed(2));
}

export function toCents(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

/**
 * quantity × unit price, rounded half-up to paise — exact for a 3-dp
 * quantity and a 2-dp price (the scales the schema stores), as Postgres's
 * ROUND(quantity * unit_cost, 2) would give.
 */
export function multiplyToMoney(quantity: string, unitPrice: string): string {
  const scaled = (value: string, places: number): bigint => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const n = BigInt(whole || '0') * 10n ** BigInt(places) + BigInt((fraction + '0'.repeat(places)).slice(0, places) || '0');
    return negative ? -n : n;
  };
  const product = scaled(quantity, 3) * scaled(unitPrice, 2); // scale 5
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const cents = (abs + 500n) / 1000n; // scale 5 → 2, half-up
  return fromCents(negative ? -cents : cents);
}

/**
 * `rate` percent of a money amount, divided by `parts` (2 for CGST/SGST's
 * half each), rounded half-up to paise. Exact for rates with up to 3
 * decimals ("18.00", "0.1", "0.075").
 */
export function percentOfMoney(amount: string, rate: string, parts = 1): string {
  const [whole, fraction = ''] = rate.split('.');
  const rateMilli = BigInt(whole || '0') * 1000n + BigInt((fraction + '000').slice(0, 3));
  const cents = toCents(amount);
  const negative = cents < 0n;
  const numerator = (negative ? -cents : cents) * rateMilli;
  const denominator = 100000n * BigInt(parts);
  const result = (numerator * 2n + denominator) / (denominator * 2n); // half-up
  return fromCents(negative ? -result : result);
}
