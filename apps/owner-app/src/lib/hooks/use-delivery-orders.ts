'use client';

import { useQuery } from '@tanstack/react-query';
import type { OrdersBoard, OrdersBoardDay, RouteRecord, RouteStopRecord } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

/** The owner's Delivery Orders list (redesign V1.1): cards for today, tomorrow or all days, searchable. */
export function useOrdersBoard(day: OrdersBoardDay, q: string) {
  return useQuery({
    queryKey: ['orders', 'board', day, q],
    queryFn: () => apiGet<OrdersBoard>('orders/board', { day, q: q.trim() || undefined, pageSize: 100 }),
    placeholderData: (previous) => previous,
  });
}

/** The business's delivery routes, active first. */
export function useRoutes() {
  return useQuery({ queryKey: ['routes'], queryFn: () => apiGet<RouteRecord[]>('routes'), staleTime: 60_000 });
}

/** A route's name from its id, for detail views. */
export function useRouteName() {
  const routes = useRoutes();
  return (id: string | null) => (id ? (routes.data?.find((r) => r.id === id)?.name ?? '…') : '—');
}

/** "D-00231". */
export const formatOrderNumber = (n: number) => `D-${String(n).padStart(5, '0')}`;

/** A route's customers and farmers, in visiting order. */
export function useRouteStops(routeId: string | null) {
  return useQuery({
    queryKey: ['routes', routeId, 'stops'],
    queryFn: () => apiGet<RouteStopRecord[]>(`routes/${routeId}/stops`),
    enabled: routeId !== null,
  });
}
