import { zonedParts, zonedToUtc } from '../../common/zoned-time';

/**
 * Delegation (Owner Independence, client Q&A 1 Oct 2026, D: Q14–Q17).
 *
 * What a driver may do on the road comes in four levels:
 *
 *   1  Delivery + POD
 *   2  Delivery + collection (cash, UPI, bank deposits, spot sales)
 *   3  Procurement + delivery + collection (buying, weighing, pickups)
 *   4  Full route operator (expenses too)
 *
 * Eligibility (the employee's delegation level) is the ceiling the owner has
 * set; it authorizes nothing by itself unless the owner made it a standing
 * permission. Otherwise the owner grants a level for one trip (ends with its
 * handover), for their day off (ends at the operating-day end) or until a set
 * time. Even level 4 can't change credit limits or prices, write off debt,
 * touch the books or close a trip — those need owner permissions a driver
 * role doesn't carry.
 */

export type DelegationLevel = 1 | 2 | 3 | 4;
export type DelegationKind = 'trip' | 'day_off' | 'temporary';

export interface DelegationRecord {
  id: string;
  driverEmployeeId: string;
  level: DelegationLevel;
  kind: DelegationKind;
  tripId: string | null;
  endsAt: Date | null;
  note: string | null;
  grantedBy: string;
  grantedAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/** What each driver action needs. */
export const CAPABILITY_LEVEL = {
  deliver: 1,
  collect: 2,
  deposit: 2,
  spot_sale: 2,
  procure: 3,
  expense: 4,
} as const;
export type Capability = keyof typeof CAPABILITY_LEVEL;

export const LEVEL_NAMES: Record<DelegationLevel, string> = {
  1: 'Delivery + POD',
  2: 'Delivery + collection',
  3: 'Procurement + delivery + collection',
  4: 'Full route operator',
};

export interface Authority {
  /** 0: not authorized for this trip at all. */
  level: 0 | DelegationLevel;
  /** Where the level comes from. */
  source: 'standing' | DelegationKind | null;
  /** The eligibility ceiling; null when the driver isn't eligible. */
  eligibleUpTo: number | null;
  /** When it lapses, if it does on its own (day-off and temporary grants). */
  until: Date | null;
  can: Record<Capability, boolean>;
}

/** Trips a trip-scoped grant still covers: it ends with the handover. */
const TRIP_GRANT_LIVE = new Set(['planned', 'in_progress']);

export function isGrantActive(
  grant: Pick<DelegationRecord, 'kind' | 'tripId' | 'endsAt' | 'revokedAt'>,
  trip: { id: string; status: string } | null,
  now: Date,
): boolean {
  if (grant.revokedAt) return false;
  if (grant.kind === 'trip') return !!trip && grant.tripId === trip.id && TRIP_GRANT_LIVE.has(trip.status);
  return !!grant.endsAt && grant.endsAt > now;
}

export function authorityOf(
  employee: { delegationLevel: number | null; standingDelegation: boolean },
  grants: DelegationRecord[],
  trip: { id: string; status: string } | null,
  now = new Date(),
): Authority {
  const ceiling = employee.delegationLevel ?? 0;
  let level = employee.standingDelegation ? ceiling : 0;
  let source: Authority['source'] = level > 0 ? 'standing' : null;
  let until: Date | null = null;
  for (const g of grants) {
    if (!isGrantActive(g, trip, now)) continue;
    const granted = Math.min(g.level, ceiling);
    if (granted > level) {
      level = granted;
      source = g.kind;
      until = g.endsAt;
    }
  }
  const can = Object.fromEntries(
    (Object.keys(CAPABILITY_LEVEL) as Capability[]).map((c) => [c, level >= CAPABILITY_LEVEL[c]]),
  ) as Record<Capability, boolean>;
  return { level: level as Authority['level'], source, eligibleUpTo: employee.delegationLevel, until, can };
}

/**
 * The UTC moment the business's operating day ends: today's [dayEnd]
 * ("HH:MM[:SS]") in [timeZone], or tomorrow's if that has already passed.
 */
export function operatingDayEnd(dayEnd: string, timeZone: string, now = new Date()): Date {
  const [h, m] = dayEnd.split(':').map(Number);
  const local = zonedParts(now, timeZone);
  let candidate = zonedToUtc(local.year, local.month, local.day, h, m, timeZone);
  if (candidate <= now) candidate = zonedToUtc(local.year, local.month, local.day + 1, h, m, timeZone);
  return candidate;
}
