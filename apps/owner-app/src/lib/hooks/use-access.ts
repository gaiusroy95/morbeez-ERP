'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/client';

/** The business's free trial or subscription (GET /tenants/me/access). */
export interface Access {
  state: 'trial' | 'active' | 'unlimited' | 'ended';
  trialEndsAt: string | null;
  subscribedUntil: string | null;
  trialDaysLeft: number | null;
}

export function useAccess() {
  return useQuery({
    queryKey: ['tenant-access'],
    queryFn: () => apiGet<Access>('tenants/me/access'),
    staleTime: 5 * 60_000,
  });
}
