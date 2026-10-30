// A driver's phone, as its last report left it (owner Phase 8, the client's
// Offline Sync screen). The phone reports after every sync pass; the
// server only knows what it was last told.

export type PhoneState = 'synced' | 'waiting' | 'stuck' | 'quiet' | 'never';

export interface LastReport {
  pendingOperations: number;
  failedOperations: number;
  pendingPhotos: number;
  failedPhotos: number;
  reportedAt: Date;
}

/** Not heard from for this long, a phone's last word is too old to go by. */
export const QUIET_AFTER_MINUTES = 120;

/**
 * stuck — the server refused something it sent (someone must look);
 * quiet — not heard from for two hours (off, no signal, or the app closed);
 * waiting — work recorded on it not sent yet; synced — nothing left on it;
 * never — no report from it at all.
 */
export function phoneState(r: LastReport | null, now: Date, quietAfterMinutes = QUIET_AFTER_MINUTES): PhoneState {
  if (!r) return 'never';
  if (r.failedOperations + r.failedPhotos > 0) return 'stuck';
  if (now.getTime() - r.reportedAt.getTime() > quietAfterMinutes * 60_000) return 'quiet';
  if (r.pendingOperations + r.pendingPhotos > 0) return 'waiting';
  return 'synced';
}
