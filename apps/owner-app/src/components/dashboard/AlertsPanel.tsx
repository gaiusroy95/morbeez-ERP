'use client';

import Link from 'next/link';
import type { AlertCode, DashboardAlert } from '@morbeez/shared-types';
import { useDashboardAlerts } from '@/lib/hooks/use-dashboard';
import { formatCount, formatMoney } from '@/lib/format';
import { ErrorState, SkeletonLines } from '../ui/Panel';

interface AlertCopy {
  title: string;
  detail: (count: string, amount: string | null) => string;
  href: string;
  action: string;
}

// The time windows in these sentences match ALERT_THRESHOLDS in the
// backend's dashboard.service.ts — change both together.
const COPY: Record<AlertCode, AlertCopy> = {
  cash_variance: {
    title: 'Cash short on reconciled trips',
    detail: (count, amount) => `${count} trip(s) in the last 30 days came back ${amount} short.`,
    href: '/finance#trips',
    action: 'Review trip cash',
  },
  customer_credit_breach: {
    title: 'Customers over their credit limit',
    detail: (count, amount) => `${count} customer(s) are over their limit by ${amount} in total.`,
    href: '/customers',
    action: 'Review customers',
  },
  approvals_pending: {
    title: 'Approvals waiting on a decision',
    detail: (count) => `${count} request(s) are holding up orders or purchases.`,
    href: '/orders',
    action: 'Review orders',
  },
  lots_awaiting_grading: {
    title: 'Produce waiting to be graded',
    detail: (count) => `${count} lot(s) arrived more than 12 hours ago and haven't been graded.`,
    href: '/procurement',
    action: 'Go to procurement',
  },
  aging_stock: {
    title: 'Stock aging in the warehouse',
    detail: (count, amount) => `${count} lot(s) worth ${amount} have been in stock for 3 days or more.`,
    href: '/inventory',
    action: 'Review stock',
  },
  farmer_payments_overdue: {
    title: 'Farmer payments overdue',
    detail: (count, amount) => `${count} graded lot(s) worth ${amount} have gone unpaid for over a week.`,
    href: '/finance#payables',
    action: 'Review payables',
  },
  trips_unreconciled: {
    title: 'Trips not yet reconciled',
    detail: (count) => `${count} trip(s) finished more than a day ago still need their cash checked.`,
    href: '/logistics',
    action: 'Reconcile trips',
  },
};

function AlertRow({ alert, currency }: { alert: DashboardAlert; currency: string }) {
  const copy = COPY[alert.code];
  const count = formatCount(alert.count);
  const amount = alert.amount === null ? null : formatMoney(alert.amount, currency);
  return (
    <li className="alert" data-severity={alert.severity}>
      <span className="alert-badge">{count}</span>
      <div>
        <div className="alert-title">
          <span className="visually-hidden">{alert.severity === 'critical' ? 'Critical: ' : 'Warning: '}</span>
          {copy.title}
        </div>
        <div className="alert-detail">{copy.detail(count, amount)}</div>
      </div>
      <Link className="alert-link" href={copy.href}>
        {copy.action} →
      </Link>
    </li>
  );
}

export function AlertsPanel() {
  const { data, error, isPending, refetch } = useDashboardAlerts();

  return (
    <section aria-labelledby="alerts-heading">
      <h2 id="alerts-heading" className="section-label">
        Needs attention
      </h2>
      {isPending ? (
        <div className="panel panel-body">
          <SkeletonLines lines={2} height={36} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : data.alerts.length === 0 ? (
        <div className="all-clear">Nothing needs your attention right now.</div>
      ) : (
        <ul className="alerts" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.alerts.map((alert) => (
            <AlertRow key={alert.code} alert={alert} currency={data.currency} />
          ))}
        </ul>
      )}
    </section>
  );
}
