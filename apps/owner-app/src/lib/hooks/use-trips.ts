'use client';

import { useQuery } from '@tanstack/react-query';
import type { TripPlan, TripQuantities, TripsBoard, TripsBoardDay } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

/** The owner's Trips list (redesign V1.1): cards for today, tomorrow or all days, searchable. */
export function useTripsBoard(day: TripsBoardDay, q: string) {
  return useQuery({
    queryKey: ['logistics', 'board', day, q],
    queryFn: () => apiGet<TripsBoard>('logistics/trips/board', { day, q: q.trim() || undefined, pageSize: 100 }),
    placeholderData: (previous) => previous,
  });
}

/** "Create Trip": the route's orders and farmers' pickups for the day, and the vehicle's capacity and stock. */
export function useTripPlan(date: string, routeId: string, vehicleId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['logistics', 'plan', date, routeId, vehicleId],
    queryFn: () =>
      apiGet<TripPlan>('logistics/trips/plan', { date, routeId: routeId || undefined, vehicleId: vehicleId || undefined }),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    placeholderData: (previous) => previous,
  });
}

/** A trip's quantities product by product, and the closing count once closed. */
export function useTripQuantities(tripId: string | null) {
  return useQuery({
    queryKey: ['logistics', 'trip', tripId, 'quantities'],
    queryFn: () => apiGet<TripQuantities>(`logistics/trips/${tripId}/quantities`),
    enabled: tripId !== null,
  });
}
