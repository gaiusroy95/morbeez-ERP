'use client';

import { useQuery } from '@tanstack/react-query';
import type { SyncStatus } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// Driver phones' offline sync (owner Phase 8): as each phone last reported, refreshed while open.

export const useSyncStatus = () => useQuery({ queryKey: ['devices', 'sync'], queryFn: () => apiGet<SyncStatus>('devices/sync-status'), refetchInterval: 60_000 });
