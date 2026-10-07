'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import { apiGet } from '@/lib/api/client';
import { useT } from '@/lib/i18n';

/**
 * Exceptions waiting for the owner (client Q&A, E: Q19). Checked every
 * minute while the app is open; red when any of them is critical.
 */
export function AlertBell() {
  const { data } = useQuery({
    queryKey: ['alerts', 'unread-count'],
    queryFn: () => apiGet<{ unread: number; critical: number }>('alerts/unread-count'),
    refetchInterval: 60_000,
  });
  const unread = data?.unread ?? 0;
  const t = useT();
  const label =
    unread === 0
      ? t('Alerts: nothing new')
      : data?.critical
        ? t('Alerts: {n} new, {c} critical', { n: unread, c: data.critical })
        : t('Alerts: {n} new', { n: unread });
  return (
    <Link href="/alerts" className="icon-button alert-bell" aria-label={label} title={label}>
      <Icon name="bell" />
      {unread > 0 && (
        <span className="alert-count" data-critical={data?.critical ? true : undefined} aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
