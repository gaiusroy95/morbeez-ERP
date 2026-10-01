'use client';

import { useQuery } from '@tanstack/react-query';

// Reads the signed-in user's role/permission context, for UI decisions
// only — the backend is the real gate (System Architecture FE.5).
export interface Session {
  userId: string;
  /** A mobile number (+91…) or an email. */
  login: string;
  roles: string[];
  permissions: string[];
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<Session> => {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('Not signed in');
      }
      if (!response.ok) throw new Error('Could not load your session');
      return (await response.json()) as Session;
    },
    staleTime: 60_000,
  });
}

export function hasPermission(session: Session | undefined, permission: string): boolean {
  return session?.permissions.includes(permission) ?? false;
}
