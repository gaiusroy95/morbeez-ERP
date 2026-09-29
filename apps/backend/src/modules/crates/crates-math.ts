// Crate arithmetic, pure: how long a party has held crates (first in,
// first out — returns come off the oldest crates first), and the alerts
// that follow from balances, ages, limits and reorder levels.

export interface HolderEvent {
  on: string; // YYYY-MM-DD, tenant-local
  delta: number; // + crates in, − crates out
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The date the longest-held crate still out went to this holder, and how
 * many are out. Events are one crate type's movements for one holder;
 * a return takes the oldest crates first. Order within a day doesn't
 * matter for the answer, so events are sorted by date, ins before outs.
 */
export function oldestOutstanding(events: HolderEvent[]): { since: string | null; outstanding: number } {
  const sorted = [...events].sort((a, b) => (a.on === b.on ? b.delta - a.delta : a.on < b.on ? -1 : 1));
  const lots: { on: string; qty: number }[] = [];
  for (const e of sorted) {
    if (e.delta > 0) {
      lots.push({ on: e.on, qty: e.delta });
      continue;
    }
    let out = -e.delta;
    while (out > 0 && lots.length) {
      const take = Math.min(out, lots[0].qty);
      lots[0].qty -= take;
      out -= take;
      if (lots[0].qty === 0) lots.shift();
    }
  }
  const outstanding = lots.reduce((s, l) => s + l.qty, 0);
  return { since: lots[0]?.on ?? null, outstanding };
}

/** The earliest of several dates, ignoring nulls. */
export function earliest(dates: (string | null)[]): string | null {
  return dates.filter((d): d is string => d !== null).sort()[0] ?? null;
}

/**
 * Overdue: held past the tenant's allowance → attention; past twice it →
 * bad. Null when the holder holds nothing or isn't late.
 */
export function overdueSeverity(daysHeld: number | null, allowance: number): 'attention' | 'bad' | null {
  if (daysHeld === null || daysHeld <= allowance) return null;
  return daysHeld > allowance * 2 ? 'bad' : 'attention';
}
