'use client';

import Link from 'next/link';
import { Home } from '@/components/home/Home';
import { NAV } from '@/components/layout/nav';
import { SkeletonLines } from '@/components/ui/Panel';
import { hasPermission, Session, useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

function NoAccess({ session }: { session: Session }) {
  const firstAllowed = NAV.flatMap((group) => group.items).find(
    (item) => item.href !== '/dashboard' && (!item.permission || hasPermission(session, item.permission)),
  );
  const t = useT();
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Dashboard')}</h1>
        </div>
      </div>
      <div className="panel placeholder">
        <strong>{t("Your role doesn't include the dashboard.")}</strong>
        <p>
          {t('Ask the business owner to add dashboard access to your role if you need it.')}
          {firstAllowed && (
            <>
              {' '}
              {t('Meanwhile, this is open to you:')} <Link href={firstAllowed.href}>{t(firstAllowed.label)}</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();

  // Wait for the session before firing the dashboard query, so a role
  // without access gets one clear message instead of a 403.
  if (!session) {
    return (
      <div className="home">
        <SkeletonLines lines={6} height={40} />
      </div>
    );
  }
  if (!hasPermission(session, 'dashboard:read')) return <NoAccess session={session} />;
  return <Home />;
}
