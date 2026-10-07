'use client';

import { useQuery } from '@tanstack/react-query';
import type { DayOffState, DelegationListItem, DriverPoolEntry, EveningSummary, OwnerAlert } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// Owner independence: the driver pool, grants, day-off mode, alerts and the
// evening summary. Every read sits under ['delegation'] or ['alerts'].

export const useDriverPool = () =>
  useQuery({ queryKey: ['delegation', 'drivers'], queryFn: () => apiGet<DriverPoolEntry[]>('delegation/drivers') });

export const useGrants = () =>
  useQuery({ queryKey: ['delegation', 'grants'], queryFn: () => apiGet<DelegationListItem[]>('delegation/grants') });

export const useDayOff = () => useQuery({ queryKey: ['delegation', 'day-off'], queryFn: () => apiGet<DayOffState>('delegation/day-off') });

export const useAlerts = (unreadOnly: boolean) =>
  useQuery({
    queryKey: ['alerts', 'list', unreadOnly],
    queryFn: () => apiGet<OwnerAlert[]>('alerts', { unread: unreadOnly ? 'true' : undefined, limit: 100 }),
    refetchInterval: 60_000,
  });

export const useEveningSummary = (date: string | undefined) =>
  useQuery({
    queryKey: ['alerts', 'summary', date ?? 'today'],
    queryFn: () => apiGet<EveningSummary>('alerts/summary', { date }),
    placeholderData: (previous: EveningSummary | undefined) => previous,
  });

/** What each level lets a driver do (client Q&A, D: Q14). */
export const LEVELS = [
  { level: 1, name: 'Delivery + POD', covers: 'Delivers and captures proof of delivery.' },
  { level: 2, name: 'Delivery + collection', covers: 'Also takes cash and UPI, records bank deposits, makes spot sales.' },
  { level: 3, name: 'Procurement + delivery', covers: 'Also buys from farmers: pickups and weighing.' },
  { level: 4, name: 'Full route operator', covers: 'Runs the whole route, expenses included — never prices, credit, write-offs, the books or closing.' },
] as const;

export const levelName = (level: number | null) => (level ? LEVELS[level - 1]?.name ?? `Level ${level}` : 'Not eligible');
