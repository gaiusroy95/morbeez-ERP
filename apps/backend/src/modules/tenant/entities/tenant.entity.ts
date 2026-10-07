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
  /** When the business's day ends ("HH:MM", its own timezone): day-off delegations end here. */
  operatingDayEnd: string;
  /** Set while the owner has handed the day over (day-off mode). */
  ownerAwayUntil: Date | null;
  /** A cash handover this far off expected alerts the owner at once. */
  alertCashThreshold: string;
  /** Cash customers this far short alerts the owner at once. */
  alertCollectionThreshold: string;
  /** Transit shrinkage on live birds the owner accepts, % — unless a product sets its own. */
  defaultShrinkageTolerancePct: string;
  /** Egg breakage the owner accepts, % — unless a product sets its own. */
  defaultBreakageTolerancePct: string;
  /** A photo of the customer's scale with a customer-end weight. */
  weighmentPhoto: 'optional' | 'required' | 'not_required';
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
