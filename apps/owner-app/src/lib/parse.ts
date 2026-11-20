// Turns what someone typed into what a request body carries. The backend
// DTOs take money and quantities as JSON numbers with a fixed number of
// decimals (money 2, quantity 3) and re-validate everything; these checks
// exist so the person hears about a typo before the round trip, in words.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T,>(error: string): Parsed<T> => ({ ok: false, error });

/**
 * A non-negative decimal with at most `decimals` places. Commas are
 * allowed as typed ("1,20,000.50") and ignored. `positive` rejects zero.
 */
export function parseDecimal(
  text: string,
  label: string,
  { decimals, positive = false, max }: { decimals: 2 | 3; positive?: boolean; max?: number },
): Parsed<number> {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '') return fail(`Enter ${label}.`);
  const pattern = decimals === 2 ? /^\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,3})?$/;
  if (!pattern.test(cleaned)) {
    return fail(`${capitalise(label)} must be a number with at most ${decimals} decimal places.`);
  }
  const value = Number(cleaned);
  if (positive && value <= 0) return fail(`${capitalise(label)} must be more than zero.`);
  if (max !== undefined && value > max) return fail(`${capitalise(label)} can't be more than ${max}.`);
  return ok(value);
}

export const parseMoney = (text: string, label: string, positive = false) =>
  parseDecimal(text, label, { decimals: 2, positive });

export const parseQuantity = (text: string, label: string, positive = true) =>
  parseDecimal(text, label, { decimals: 3, positive });

/** An optional money field: blank means "not given". */
export function parseOptionalMoney(text: string, label: string): Parsed<number | undefined> {
  return text.trim() === '' ? ok(undefined) : parseMoney(text, label);
}

export function parseWholeNumber(text: string, label: string, min: number, max: number): Parsed<number> {
  const cleaned = text.trim();
  if (!/^\d+$/.test(cleaned)) return fail(`${capitalise(label)} must be a whole number.`);
  const value = Number(cleaned);
  if (value < min || value > max) return fail(`${capitalise(label)} must be between ${min} and ${max}.`);
  return ok(value);
}

/** Blank → undefined, so optional text fields aren't sent as "". */
export function optionalText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A <input type="datetime-local"> value (wall-clock time, no zone) as an
 * ISO instant, reading it in the browser's zone — which is where the
 * person picking the time is.
 */
export function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Where a place is, as someone enters it: "12.3108, 76.6402" (a comma or a
 * space between), or a Google Maps link pasted from the share button
 * (…/@12.3108,76.6402,17z, …?q=12.3108,76.6402, …!3d12.3108!4d76.6402).
 * Blank is no location (null). Kept to 6 decimals — about 10 cm.
 */
export function parseLocation(text: string): Parsed<{ latitude: number; longitude: number } | null> {
  const value = text.trim();
  if (!value) return ok(null);
  const n = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`!3d${n}!4d${n}`),
    new RegExp(String.raw`@${n},${n}`),
    new RegExp(String.raw`[?&](?:q|query|ll|destination)=${n}(?:,|%2C)\s*${n}`, 'i'),
    new RegExp(String.raw`^${n}\s*[,\s]\s*${n}$`),
  ];
  for (const pattern of patterns) {
    const m = value.match(pattern);
    if (!m) continue;
    const latitude = Number(m[1]);
    const longitude = Number(m[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) break;
    if (latitude === 0 && longitude === 0) break;
    return ok({ latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 });
  }
  return fail('Enter the location as latitude, longitude (e.g. 12.3108, 76.6402), paste a Google Maps link, or use this phone’s location.');
}

/** Collects the first error from a set of parsed fields, or their values. */
export function firstError(results: Parsed<unknown>[]): string | null {
  for (const result of results) if (!result.ok) return result.error;
  return null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
