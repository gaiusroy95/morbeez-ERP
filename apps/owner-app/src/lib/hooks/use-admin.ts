'use client';

import { useQuery } from '@tanstack/react-query';
import type { ActivityEntry, ApprovalsInbox, DriverRequest, DriverIncentiveSettings, OnTheRoad, ReportKind, ReportTable, RoleSummary, TeamMember, TripIncentives, VehicleTrips } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// The owner's management screens (redesign Phase 7): Approvals & Exceptions,
// Reports, Users & permissions, My Profile, Workforce & Vehicles.

/** What a driver asked for from the road (D10), with what the owner needs to decide it. */
export function useDriverRequest(id: string | null) {
  return useQuery({ queryKey: ['approvals', 'driver-request', id], queryFn: () => apiGet<DriverRequest>(`driver-requests/${id}`), enabled: id !== null });
}

export function useApprovalsInbox() {
  return useQuery({
    queryKey: ['approvals', 'inbox'],
    queryFn: () => apiGet<ApprovalsInbox>('dashboard/approvals'),
    refetchInterval: 60_000,
  });
}

/** A report for the dates; a master list ignores them. Null kind: nothing open. */
export function useReport(kind: ReportKind | null, from: string, to: string) {
  return useQuery({
    queryKey: ['reports', kind, from, to],
    queryFn: () => apiGet<ReportTable>(`reports/${kind}`, { from: from || undefined, to: to || undefined }),
    enabled: kind !== null,
    placeholderData: (previous) => (previous?.kind === kind ? previous : undefined),
  });
}

export function useTeam(enabled = true) {
  return useQuery({ queryKey: ['users', 'team'], queryFn: () => apiGet<TeamMember[]>('users/team'), enabled });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: ['users', 'roles'], queryFn: () => apiGet<RoleSummary[]>('users/roles'), enabled });
}

export function useMyActivity(enabled: boolean) {
  return useQuery({ queryKey: ['users', 'me', 'activity'], queryFn: () => apiGet<ActivityEntry[]>('users/me/activity'), enabled });
}

/** Trips on the road now and their crew: who is "On trip", which vehicles are out. */
export function useOnTheRoad(enabled = true) {
  return useQuery({
    queryKey: ['logistics', 'on-the-road'],
    queryFn: () => apiGet<OnTheRoad[]>('logistics/trips/on-the-road'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useVehicleTrips(vehicleId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['logistics', 'vehicle-trips', vehicleId],
    queryFn: () => apiGet<VehicleTrips>(`logistics/trips/vehicles/${vehicleId}`),
    enabled: enabled && vehicleId !== null,
  });
}

/** The owner's incentive rules for drivers (driver app D7). */
export function useDriverIncentives(enabled = true) {
  return useQuery({ queryKey: ['workforce', 'driver-incentives'], queryFn: () => apiGet<DriverIncentiveSettings>('workforce/payroll/driver-incentives'), enabled });
}

/** What the driver earned on a trip: kept at the close, else an estimate. */
export function useTripIncentives(tripId: string | null) {
  return useQuery({ queryKey: ['logistics', 'trip', tripId, 'incentives'], queryFn: () => apiGet<TripIncentives>(`logistics/trips/${tripId}/incentives`), enabled: tripId !== null });
}
