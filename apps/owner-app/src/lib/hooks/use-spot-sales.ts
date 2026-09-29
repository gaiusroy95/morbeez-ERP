'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated, SpotPriceBand, SpotSaleRecord, SpotSalesSummary, SpotSettings, SpotVehicleStockRow } from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import type { DateRange } from './use-accounting';

// Every spot-sale read shares the ['spot'] root, so any spot action refreshes them all.

const keep = <T,>(previous: T | undefined) => previous;

const PAGE_SIZE = 50;

export const useSpotSales = (range: DateRange | null, status: string | null, page: number) =>
  useQuery({
    queryKey: ['spot', 'sales', range, status, page],
    queryFn: () =>
      apiGet<Paginated<SpotSaleRecord>>('spot-sales', { from: range?.from, to: range?.to, status: status ?? undefined, page, pageSize: PAGE_SIZE }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useSpotSummary = (range: DateRange | null) =>
  useQuery({
    queryKey: ['spot', 'summary', range],
    queryFn: () => apiGet<SpotSalesSummary>('spot-sales/summary', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useSpotSale = (id: string | null) =>
  useQuery({ queryKey: ['spot', 'sale', id], queryFn: () => apiGet<SpotSaleRecord>(`spot-sales/${id}`), enabled: id !== null });

export const useVehicleStock = (tripId: string | null) =>
  useQuery({ queryKey: ['spot', 'stock', tripId], queryFn: () => apiGet<SpotVehicleStockRow[]>(`spot-sales/trips/${tripId}/stock`), enabled: tripId !== null });

export const usePriceBands = (enabled = true) =>
  useQuery({ queryKey: ['spot', 'bands'], queryFn: () => apiGet<SpotPriceBand[]>('spot-sales/price-bands'), enabled });

export const useSpotSettings = (enabled = true) =>
  useQuery({ queryKey: ['spot', 'settings'], queryFn: () => apiGet<SpotSettings>('spot-sales/settings'), enabled });
