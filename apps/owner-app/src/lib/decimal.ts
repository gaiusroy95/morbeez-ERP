// Exact sums of 2-dp money strings via integer paise, for totals a screen
// shows across rows it already has. Never floats (Constitution III.2).
export function sumMoney(values: string[]): string {
  const cents = values.reduce((total, value) => total + toCents(value), 0n);
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

function toCents(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** `value` less another, exactly. */
export function subtractMoney(value: string, less: string): string {
  return sumMoney([value, less.startsWith('-') ? less.slice(1) : `-${less}`]);
}

/** `ratePct`% of `value`, half-up to the paisa — what the server withholds (Constitution III.2). */
export function percentOfMoney(value: string, ratePct: string): string {
  const basisPoints = toCents(ratePct); // "2.00" % → 200 basis points
  const cents = (toCents(value) * basisPoints * 2n + 10_000n) / 20_000n;
  return sumMoney([`${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`]);
}
