'use client';

import Link from 'next/link';
import { AlertsPanel } from '@/components/dashboard/AlertsPanel';
import { KpiSection } from '@/components/dashboard/KpiSection';
import { OperationsPanel } from '@/components/dashboard/OperationsPanel';
import { PeriodPicker } from '@/components/dashboard/PeriodPicker';
import { ProfitPanel } from '@/components/dashboard/ProfitPanel';
import { NAV } from '@/components/layout/nav';
import { SkeletonLines } from '@/components/ui/Panel';
import { useDashboardKpis } from '@/lib/hooks/use-dashboard';
import { hasPermission, Session, useSession } from '@/lib/hooks/use-tenant';
import { useUiStore } from '@/lib/stores/ui-store';

function Header() {
  return (
    <div className="page-header" style={{ marginBottom: 0 }}>
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">How the business is doing, and what needs you today.</p>
      </div>
      <PeriodPicker />
    </div>
  );
}

function NoAccess({ session }: { session: Session }) {
  const firstAllowed = NAV.flatMap((group) => group.items).find(
    (item) => item.href !== '/dashboard' && (!item.permission || hasPermission(session, item.permission)),
  );
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
        </div>
      </div>
      <div className="panel placeholder">
        <strong>Your role doesn&apos;t include the dashboard.</strong>
        <p>
          Ask the business owner to add dashboard access to your role if you need it.
          {firstAllowed && (
            <>
              {' '}
              Meanwhile, <Link href={firstAllowed.href}>{firstAllowed.label}</Link> is open to you.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function DashboardContent({ canSeeProfit }: { canSeeProfit: boolean }) {
  const days = useUiStore((s) => s.dashboardRange);
  // The profit panel needs the tenant's currency; KPIs already carry it.
  const { data: kpis } = useDashboardKpis(days);

  // Order is deliberate: what needs action first, then the period's
  // figures, then margin, then today's floor — summary before detail.
  return (
    <div className="dashboard">
      <Header />
      <AlertsPanel />
      <KpiSection days={days} />
      {canSeeProfit && kpis && <ProfitPanel days={days} currency={kpis.period.currency} />}
      <OperationsPanel />
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();

  // Wait for the session before firing any dashboard query, so a role
  // without access gets one clear message instead of four 403s.
  if (!session) {
    return (
      <div className="dashboard">
        <Header />
        <div className="panel panel-body">
          <SkeletonLines lines={4} height={28} />
        </div>
      </div>
    );
  }
  if (!hasPermission(session, 'dashboard:read')) return <NoAccess session={session} />;
  return <DashboardContent canSeeProfit={hasPermission(session, 'dashboard:profit')} />;
}
