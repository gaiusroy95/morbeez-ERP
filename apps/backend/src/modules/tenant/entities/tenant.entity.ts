export interface TenantRecord {
  id: string;
  name: string;
  plan: string;
  currency: string;
  timezone: string;
  taxRegistration: string | null;
  branding: Record<string, unknown>;
  /** End of the free trial; null for a business with no trial limit. */
  trialEndsAt: Date | null;
  /** Paid through this moment; null when never subscribed. */
  subscribedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Where a business stands, and so what the API lets it do:
 * - trial: free, full access, until trialEndsAt
 * - active: paid through subscribedUntil
 * - unlimited: no trial and no subscription dates (set up by the team)
 * - ended: the trial is over and nothing is paid: read-only
 */
export type AccessState = 'trial' | 'active' | 'unlimited' | 'ended';

export interface TenantAccess {
  state: AccessState;
  trialEndsAt: Date | null;
  subscribedUntil: Date | null;
  /** Days of trial left, counting today (1 on its last day); null outside a trial. */
  trialDaysLeft: number | null;
}

export const TRIAL_DAYS = 30;

export function accessOf(tenant: Pick<TenantRecord, 'trialEndsAt' | 'subscribedUntil'>, now = new Date()): TenantAccess {
  const { trialEndsAt, subscribedUntil } = tenant;
  const base = { trialEndsAt, subscribedUntil, trialDaysLeft: null };
  if (subscribedUntil && subscribedUntil > now) return { ...base, state: 'active' };
  if (!trialEndsAt && !subscribedUntil) return { ...base, state: 'unlimited' };
  if (trialEndsAt && trialEndsAt > now) {
    const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000);
    return { ...base, state: 'trial', trialDaysLeft: daysLeft };
  }
  return { ...base, state: 'ended' };
}
