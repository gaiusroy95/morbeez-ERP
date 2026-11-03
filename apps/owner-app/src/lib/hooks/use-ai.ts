'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated, AiRecommendation, AiRecommendationType, AiRunSummary, AiScorecard, AiSettings, CallList, CustomerProfitReport, InboundMessage, IntegrationsStatus, PlacePin, PricingBoard, VoiceCall } from '@morbeez/shared-types';
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

// ---- Owner Phase 8: AI Pricing, AI Calling ----

export const useAiPricing = () => useQuery({ queryKey: ['ai', 'pricing'], queryFn: () => apiGet<PricingBoard>('ai/pricing') });

export const useAiCalls = () => useQuery({ queryKey: ['ai', 'calls'], queryFn: () => apiGet<CallList>('ai/calls') });

/** Every open suggestion of a type — a screen of its own shows them all, not a page. */
export const useOpenSuggestions = (type: AiRecommendationType) =>
  useQuery({
    queryKey: ['ai', 'suggestions', 'open', type, 'all'],
    queryFn: () => apiGet<Paginated<AiRecommendation>>('ai/recommendations', { status: 'open', type, page: 1, pageSize: 100 }),
  });

// ---- The AI's channels: WhatsApp orders, AI calls ----

/** What this server has keys for, and the business's own choices (Settings → Integrations). */
export const useIntegrations = (enabled = true) => useQuery({ queryKey: ['ai', 'integrations'], queryFn: () => apiGet<IntegrationsStatus>('integrations'), enabled });

/** WhatsApp messages customers sent; refreshed while one is still being read. */
export const useWhatsAppMessages = (enabled = true) =>
  useQuery({
    queryKey: ['ai', 'whatsapp'],
    queryFn: () => apiGet<InboundMessage[]>('ai/whatsapp/messages'),
    enabled,
    refetchInterval: (q) => ((q.state.data ?? []).some((m) => m.status === 'received') ? 3_000 : 60_000),
  });

const LIVE: VoiceCall['status'][] = ['queued'];

/** AI calls of the last two weeks; refreshed every few seconds while one is under way. */
export const useVoiceCalls = (enabled = true) =>
  useQuery({
    queryKey: ['ai', 'voice-calls'],
    queryFn: () => apiGet<VoiceCall[]>('ai/calls/voice'),
    enabled,
    refetchInterval: (q) => ((q.state.data ?? []).some((c) => LIVE.includes(c.status)) ? 4_000 : 60_000),
  });
