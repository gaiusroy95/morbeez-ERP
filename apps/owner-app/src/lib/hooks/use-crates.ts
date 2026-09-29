'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CrateHolderDetail,
  CrateHolderKind,
  CrateHolding,
  CrateLoss,
  CrateMovement,
  CrateOverview,
  CrateParties,
  CrateSettings,
  CrateType,
  TripCrates,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import type { DateRange } from './use-accounting';

// Every crate read shares the ['crates'] root, so any crate action refreshes them all.

const keep = <T,>(previous: T | undefined) => previous;

export const useCrateOverview = (enabled = true) =>
  useQuery({ queryKey: ['crates', 'overview'], queryFn: () => apiGet<CrateOverview>('crates/overview'), enabled });

export const useCrateTypes = () => useQuery({ queryKey: ['crates', 'types'], queryFn: () => apiGet<CrateType[]>('crates/types') });

export const useCrateParties = () =>
  useQuery({ queryKey: ['crates', 'parties'], queryFn: () => apiGet<CrateParties>('crates/parties'), staleTime: 60_000 });

export const useHoldings = (kind: CrateHolderKind | null) =>
  useQuery({
    queryKey: ['crates', 'holdings', kind],
    queryFn: () => apiGet<CrateHolding[]>('crates/holdings', { kind: kind ?? undefined }),
    enabled: kind !== null,
    placeholderData: keep,
  });

export const useCrateHolder = (kind: CrateHolderKind, id: string | null) =>
  useQuery({
    queryKey: ['crates', 'holder', kind, id],
    queryFn: () => apiGet<CrateHolderDetail>(kind === 'yard' ? 'crates/holders/yard' : `crates/holders/${kind}/${id}`),
    enabled: kind === 'yard' || id !== null,
  });

export const useCrateMovements = (range: DateRange | null) =>
  useQuery({
    queryKey: ['crates', 'movements', range],
    queryFn: () => apiGet<CrateMovement[]>('crates/movements', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useCrateLosses = (range: DateRange | null) =>
  useQuery({
    queryKey: ['crates', 'losses', range],
    queryFn: () => apiGet<CrateLoss[]>('crates/losses', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useTripCrates = (tripId: string | null) =>
  useQuery({ queryKey: ['crates', 'trip', tripId], queryFn: () => apiGet<TripCrates>(`crates/trips/${tripId}`), enabled: tripId !== null });

export const useCrateSettings = (enabled = true) =>
  useQuery({ queryKey: ['crates', 'settings'], queryFn: () => apiGet<CrateSettings>('crates/settings'), enabled });
