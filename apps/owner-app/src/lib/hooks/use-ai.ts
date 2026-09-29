'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated, AiRecommendation, AiRecommendationType, AiRunSummary, AiScorecard, AiSettings, CustomerProfitReport, PlacePin } from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import type { DateRange } from './use-accounting';

// Every AI read shares the ['ai'] root, so any action refreshes them all.

const keep = <T,>(previous: T | undefined) => previous;

const PAGE_SIZE = 25;

export const useSuggestions = (status: 'open' | 'decided', type: AiRecommendationType | null, page: number, enabled = true) =>
  useQuery({
    queryKey: ['ai', 'suggestions', status, type, page],
    queryFn: () => apiGet<Paginated<AiRecommendation>>('ai/recommendations', { status, type: type ?? undefined, page, pageSize: PAGE_SIZE }),
    enabled,
    placeholderData: keep,
  });

export const useLastRun = () => useQuery({ queryKey: ['ai', 'last-run'], queryFn: () => apiGet<AiRunSummary | null>('ai/runs/latest') });

export const useScorecard = (enabled = true) => useQuery({ queryKey: ['ai', 'scorecard'], queryFn: () => apiGet<AiScorecard>('ai/scorecard'), enabled });

export const useCustomerProfit = (range: DateRange | null) =>
  useQuery({
    queryKey: ['ai', 'profit', range],
    queryFn: () => apiGet<CustomerProfitReport>('ai/customer-profitability', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useAiSettings = (enabled = true) => useQuery({ queryKey: ['ai', 'settings'], queryFn: () => apiGet<AiSettings>('ai/settings'), enabled });

export const usePins = (enabled = true) => useQuery({ queryKey: ['ai', 'pins'], queryFn: () => apiGet<PlacePin[]>('logistics/pins'), enabled });
