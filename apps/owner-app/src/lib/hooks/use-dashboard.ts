'use client';

import { useQuery } from '@tanstack/react-query';
import type { DashboardAlerts, DashboardKpis, DashboardOperations, DashboardProfit } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// Alerts and the operations board change through the working day; poll
// them. Server-sent events replace this polling once the event bus
// exists (System Architecture FE.6).
const LIVE_REFRESH_MS = 60_000;

export function useDashboardKpis(days: number) {
  return useQuery({
    queryKey: ['dashboard', 'kpis', days],
    queryFn: () => apiGet<DashboardKpis>('dashboard/kpis', { days }),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardProfit(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'profit', days],
    queryFn: () => apiGet<DashboardProfit>('dashboard/profit', { days }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardAlerts() {
  return useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => apiGet<DashboardAlerts>('dashboard/alerts'),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useDashboardOperations() {
  return useQuery({
    queryKey: ['dashboard', 'operations'],
    queryFn: () => apiGet<DashboardOperations>('dashboard/operations'),
    refetchInterval: LIVE_REFRESH_MS,
  });
}
