// The driver's own records (driver app V1, D6) — the rules behind them,
// kept pure so they're tested on their own (driver-records.spec.ts).

import { TripStatus } from './entities/trip.entity';
import { DriverApprovalStatus, DriverExpenseStatus, DriverMaintenanceDue, DueState } from './entities/driver-records.entity';

/** Maintenance is due soon this many km before its next-due reading. */
export const MAINTENANCE_SOON_KM = 1500;
/** …or this many days before its next-due date. */
export const MAINTENANCE_SOON_DAYS = 15;

/**
 * Where a driver's expense stands. Within their authority it's simply
 * recorded; beyond it, the owner approves or rejects it — and closing the
 * trip without a word approves it with the closure (as before Phase 7).
 */
export function expenseStatusOf(
  e: { needsApproval: boolean; decision: 'approved' | 'rejected' | null },
  tripStatus: TripStatus,
): DriverExpenseStatus {
  if (!e.needsApproval) return 'recorded';
  if (e.decision) return e.decision;
  return tripStatus === 'reconciled' ? 'approved' : 'pending';
}

/** A dispute the driver raised: open waits on the owner; resolved is settled; withdrawn didn't go ahead. */
export function disputeStatusOf(status: 'open' | 'resolved' | 'withdrawn'): DriverApprovalStatus {
  return status === 'open' ? 'pending' : status === 'resolved' ? 'approved' : 'rejected';
}

/**
 * A trip handed over: waiting while the owner checks it (or holds it),
 * approved once closed, rejected when the owner sent it back to fix (back
 * on the road with the owner's note). Null for a trip never handed over.
 */
export function handoverStatusOf(status: TripStatus, reviewNote: string | null): DriverApprovalStatus | null {
  if (status === 'completed' || status === 'on_hold') return 'pending';
  if (status === 'reconciled') return 'approved';
  if (status === 'in_progress' && reviewNote) return 'rejected';
  return null;
}

/** The stops' places in the order visited, a place repeated in a row named once ("Gundlupet → Mysuru → Gundlupet"). */
export function placesOf(places: (string | null)[]): string[] {
  const out: string[] = [];
  for (const p of places) {
    const place = p?.trim();
    if (place && out[out.length - 1] !== place) out.push(place);
  }
  return out;
}

export function minutesBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return ms >= 0 ? Math.round(ms / 60000) : null;
}

/** Whole days from [today] to [date] (YYYY-MM-DD); negative once past. */
export function daysFrom(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

interface MaintenanceRow {
  kind: string;
  description: string;
  serviceDate: string;
  odometerKm: number | null;
  nextDueDate: string | null;
  nextDueKm: number | null;
}

/**
 * What's next due on the vehicle, one line per kind of work: the latest
 * record of each kind that set a next due date or reading. Overdue once
 * the date has passed or the odometer reached it; due soon within
 * [MAINTENANCE_SOON_KM] km or [MAINTENANCE_SOON_DAYS] days. Soonest first.
 */
export function maintenanceDueOf(records: MaintenanceRow[], currentKm: number | null, today: string): DriverMaintenanceDue[] {
  const latest = new Map<string, MaintenanceRow>();
  for (const r of [...records].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate))) {
    if (!latest.has(r.kind) && (r.nextDueDate || r.nextDueKm !== null)) latest.set(r.kind, r);
  }
  const rank: Record<DueState, number> = { overdue: 0, due_soon: 1, ok: 2 };
  return [...latest.values()]
    .map((r) => {
      const kmLeft = r.nextDueKm !== null && currentKm !== null ? r.nextDueKm - currentKm : null;
      const daysLeft = r.nextDueDate ? daysFrom(today, r.nextDueDate) : null;
      const state: DueState =
        (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft < 0)
          ? 'overdue'
          : (kmLeft !== null && kmLeft <= MAINTENANCE_SOON_KM) || (daysLeft !== null && daysLeft <= MAINTENANCE_SOON_DAYS)
            ? 'due_soon'
            : 'ok';
      return {
        kind: r.kind,
        description: r.description,
        lastDate: r.serviceDate,
        lastKm: r.odometerKm,
        nextDueDate: r.nextDueDate,
        nextDueKm: r.nextDueKm,
        kmLeft,
        daysLeft,
        state,
      };
    })
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.kmLeft ?? Infinity) - (b.kmLeft ?? Infinity) || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
}
