/**
 * Wall-clock times in a business's own timezone (tenant.timezone, e.g.
 * Asia/Kolkata), without a date library: Intl knows every zone.
 */
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Wall-clock time in [timeZone] → the UTC instant. Days past the month's end roll over. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  return new Date(guess - offset);
}

/** The business's calendar day "YYYY-MM-DD" (default: today there) as a [from, to) UTC window. */
export function dayWindow(timeZone: string, date?: string, now = new Date()): { date: string; from: Date; to: Date } {
  let y: number, m: number, d: number;
  if (date) {
    [y, m, d] = date.split('-').map(Number);
  } else {
    const p = zonedParts(now, timeZone);
    [y, m, d] = [p.year, p.month, p.day];
  }
  const from = zonedToUtc(y, m, d, 0, 0, timeZone);
  const to = zonedToUtc(y, m, d + 1, 0, 0, timeZone);
  const label = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { date: label, from, to };
}
