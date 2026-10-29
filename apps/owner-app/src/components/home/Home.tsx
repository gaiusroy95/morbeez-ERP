'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { HomeAlert, HomePeriodName } from '@morbeez/shared-types';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { useDashboardHome } from '@/lib/hooks/use-dashboard';
import { formatCount, formatMoney } from '@/lib/format';
import { useI18n, useT, type Translate } from '@/lib/i18n';

/**
 * The owner's Home screen (client design V1.1, screen 1): net contribution
 * for the period, the money tiles, today's operations, alerts and one AI
 * insight. Every tile and row opens the screen behind its number.
 */

const PERIODS: { value: HomePeriodName; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
];

/** One line per alert kind; {count} and {amount} are filled in. */
function alertText(a: HomeAlert, t: Translate, money: (v: string) => string): string {
  const amount = a.amount ? money(a.amount) : '';
  const one = a.count === 1;
  const vars = { count: a.count, amount };
  switch (a.code) {
    case 'customers_overdue':
      return one ? t('1 customer overdue ({amount})', vars) : t('{count} customers overdue ({amount})', vars);
    case 'expense_approvals':
      return one ? t('1 expense approval pending') : t('{count} expense approvals pending', vars);
    case 'vehicle_documents_due':
      return one ? t('1 vehicle document due') : t('{count} vehicle documents due', vars);
    case 'farmer_payments_overdue':
      return t('Farmer payments due ({amount})', vars);
    case 'cash_variance':
      return one ? t('1 trip came back short ({amount})', vars) : t('{count} trips came back short ({amount})', vars);
    case 'customer_credit_breach':
      return one ? t('1 customer over their credit limit') : t('{count} customers over their credit limit', vars);
    case 'approvals_pending':
      return one ? t('1 approval waiting') : t('{count} approvals waiting', vars);
    case 'lots_awaiting_grading':
      return one ? t('1 lot waiting to be graded') : t('{count} lots waiting to be graded', vars);
    case 'aging_stock':
      return one ? t('1 lot ageing in stock ({amount})', vars) : t('{count} lots ageing in stock ({amount})', vars);
    case 'trips_unreconciled':
      return one ? t('1 trip not yet reconciled') : t('{count} trips not yet reconciled', vars);
  }
}

const DISMISSED_KEY = 'mz_insight_dismissed';

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function Home() {
  const t = useT();
  const { lang } = useI18n();
  const [period, setPeriod] = useState<HomePeriodName>('today');
  const { data, error, isPending, refetch } = useDashboardHome(period);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => setDismissed(readDismissed()), []);

  const today = new Date().toLocaleDateString(`${lang}-IN`, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  if (isPending) {
    return (
      <div className="home">
        <h1 className="page-title visually-hidden">{t('Dashboard')}</h1>
        <SkeletonLines lines={6} height={40} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="home">
        <h1 className="page-title visually-hidden">{t('Dashboard')}</h1>
        <div className="panel">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      </div>
    );
  }

  const money = (v: string) => formatMoney(v, data.period.currency);
  const change = data.netContribution.changePercent === null ? null : Number(data.netContribution.changePercent);
  const insight = data.insight && data.insight.id !== dismissed ? data.insight : null;

  const tiles: { href: string; icon: IconName; label: string; value: string; tone?: 'bad' | 'info' }[] = [
    { href: '/finance#receivables', icon: 'wallet', label: 'Receivables', value: money(data.receivables) },
    { href: '/finance#payables', icon: 'wallet', label: 'Payables', value: money(data.payables), tone: 'bad' },
    { href: '/finance#cash', icon: 'rupee', label: 'Cash', value: money(data.cash), tone: 'info' },
    { href: '/logistics', icon: 'truck', label: 'Active Trips', value: `${data.activeTrips.active} / ${data.activeTrips.total}` },
  ];
  const counts: { href: string; icon: IconName; label: string; value: number }[] = [
    { href: '/procurement', icon: 'basket', label: 'Procurement', value: data.today.procurement },
    { href: '/orders', icon: 'receipt', label: 'Deliveries', value: data.today.deliveries },
    { href: '/collections', icon: 'pin', label: 'Collections', value: data.today.collections },
    { href: '/logistics', icon: 'truck', label: 'Active Trips', value: data.today.activeTrips },
  ];

  return (
    <div className="home">
      <h1 className="page-title visually-hidden">{t('Dashboard')}</h1>
      <div className="home-head">
        <span className="home-date">{today}</span>
        <select className="home-period" aria-label={t('Period')} value={period} onChange={(e) => setPeriod(e.target.value as HomePeriodName)}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(p.label)}
            </option>
          ))}
        </select>
      </div>

      <section className="net-card" aria-label={t('Net Contribution')}>
        <div className="net-card-top">
          <div>
            <div className="net-label">{t('Net Contribution')}</div>
            <div className="net-value">{money(data.netContribution.value)}</div>
          </div>
          {change !== null && (
            <span className="net-change" title={t('Compared with the previous period')}>
              <Icon name={change >= 0 ? 'arrowUp' : 'arrowDown'} size={14} />
              {Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}%
            </span>
          )}
        </div>
        <div className="net-split">
          <Link href="/orders">
            <span className="net-split-label">{t('Sales')}</span>
            <span className="net-split-value">{money(data.sales)}</span>
          </Link>
          <Link href="/procurement">
            <span className="net-split-label">{t('Purchases')}</span>
            <span className="net-split-value">{money(data.purchases)}</span>
          </Link>
        </div>
      </section>

      <div className="money-tiles">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="money-tile">
            <span className="money-tile-icon" data-tone={tile.tone} aria-hidden="true">
              <Icon name={tile.icon} size={20} />
            </span>
            <span>
              <span className="money-tile-label">{t(tile.label)}</span>
              <span className="money-tile-value">{tile.value}</span>
            </span>
          </Link>
        ))}
      </div>

      <h2 className="section-title">{t("Today's Operations")}</h2>
      <div className="count-tiles">
        {counts.map((c) => (
          <Link key={c.label} href={c.href} className="count-tile">
            <Icon name={c.icon} size={20} className="count-tile-icon" />
            <span className="count-tile-value">{formatCount(c.value)}</span>
            <span className="count-tile-label">{t(c.label)}</span>
          </Link>
        ))}
      </div>

      <section className="alerts-card" aria-label={t('Alerts')}>
        <div className="alerts-head">
          {t('Alerts')}
          {data.alerts.length > 0 && <span className="alerts-count">{data.alerts.length}</span>}
          <Link href="/alerts" className="alerts-viewall">
            {t('View All')} ›
          </Link>
        </div>
        {data.alerts.length === 0 && <div className="home-alert-none">{t('Nothing needs your attention right now.')}</div>}
        {data.alerts.map((a) => (
          <Link key={a.code} href={a.href} className="home-alert">
            <span className="home-alert-icon" data-severity={a.severity} aria-hidden="true">
              <Icon name="alert" size={18} />
            </span>
            {alertText(a, t, money)}
          </Link>
        ))}
      </section>

      {insight && (
        <div className="insight-card">
          <Icon name="leaf" size={26} className="insight-icon" />
          <Link href="/ai" className="insight-body" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="insight-title">{t('AI Insight')}</div>
            <div className="insight-text">{insight.title}</div>
          </Link>
          <button
            type="button"
            className="icon-button insight-close"
            aria-label={t('Dismiss')}
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISSED_KEY, insight.id);
              } catch {
                // Hidden for this visit only.
              }
              setDismissed(insight.id);
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
