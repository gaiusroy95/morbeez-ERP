'use client';

import { useQuery } from '@tanstack/react-query';
import type { CollectionsBoard, CollectionsView, FinanceSummary, ProfitInsights, RangeName, VehicleBoard } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

/** The owner's Vehicle Stock (redesign V1.1, screen 13). */
export function useVehicleBoard(enabled = true) {
  return useQuery({
    queryKey: ['inventory', 'vehicles'],
    queryFn: () => apiGet<VehicleBoard>('inventory/vehicles'),
    enabled,
  });
}

/** Collections (screen 14): today's payments, what's due and not in, or every payment. */
export function useCollections(view: CollectionsView, q: string) {
  return useQuery({
    queryKey: ['finance', 'collections', view, q],
    queryFn: () => apiGet<CollectionsBoard>('finance/collections', { view, q: q.trim() || undefined, pageSize: 200 }),
    placeholderData: (previous) => previous,
  });
}

export interface Range {
  name: RangeName;
  from?: string;
  to?: string;
}

const rangeParams = (range: Range) => ({ period: range.name, from: range.name === 'custom' ? range.from : undefined, to: range.name === 'custom' ? range.to : undefined });
const rangeReady = (range: Range) => range.name !== 'custom' || (!!range.from && !!range.to);

/** The Finance hub (screen 15). */
export function useFinanceSummary(range: Range) {
  return useQuery({
    queryKey: ['finance', 'summary', range],
    queryFn: () => apiGet<FinanceSummary>('dashboard/finance', rangeParams(range)),
    enabled: rangeReady(range),
    placeholderData: (previous) => previous,
  });
}

/** Profit & Insights (screen 16). */
export function useProfitInsights(range: Range) {
  return useQuery({
    queryKey: ['dashboard', 'insights', range],
    queryFn: () => apiGet<ProfitInsights>('dashboard/insights', rangeParams(range)),
    enabled: rangeReady(range),
    placeholderData: (previous) => previous,
  });
}
