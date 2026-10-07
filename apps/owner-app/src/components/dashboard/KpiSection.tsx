'use client';

import type { DashboardKpis, KpiValue } from '@morbeez/shared-types';
import { useDashboardKpis } from '@/lib/hooks/use-dashboard';
import { computeDelta, formatCount, formatDate, formatMoney } from '@/lib/format';
import { ErrorState, SkeletonLines } from '../ui/Panel';
import { useT } from '@/lib/i18n';

// Whether a rise is good news. Costs going up isn't; collections going up
// is; for some figures (bookings volume vs. value) direction alone says
// little, so it stays uncoloured.
type Polarity = 'higher-better' | 'lower-better' | 'neutral';

interface KpiSpec {
  key: Exclude<keyof DashboardKpis, 'period'>;
  label: string;
  polarity: Polarity;
  note?: string;
}

const GROUPS: { title: string; items: KpiSpec[] }[] = [
  {
    title: 'Sales',
    items: [
      { key: 'deliveredRevenue', label: 'Revenue delivered', polarity: 'higher-better' },
      { key: 'deliveriesCompleted', label: 'Deliveries completed', polarity: 'higher-better' },
      { key: 'bookedOrderValue', label: 'Orders booked (value)', polarity: 'higher-better' },
      { key: 'ordersBooked', label: 'Orders booked', polarity: 'neutral' },
    ],
  },
  {
    title: 'Cash',
    items: [
      { key: 'collections', label: 'Collected from customers', polarity: 'higher-better' },
      { key: 'receivablesOutstanding', label: 'Owed by customers', polarity: 'lower-better', note: 'Delivered but not yet collected' },
      { key: 'farmerSettlements', label: 'Paid to farmers', polarity: 'neutral' },
      { key: 'farmerPayablesOutstanding', label: 'Owed to farmers', polarity: 'lower-better', note: 'Graded lots not yet settled' },
    ],
  },
  {
    title: 'Costs & stock',
    items: [
      { key: 'procurementSpend', label: 'Produce bought', polarity: 'neutral', note: 'Graded lots at their fixed cost' },
      { key: 'tripExpenses', label: 'Trip expenses', polarity: 'lower-better' },
      { key: 'stockOnHandValue', label: 'Stock on hand', polarity: 'neutral', note: 'At cost, right now' },
    ],
  },
];

function toneFor(direction: 'up' | 'down' | 'flat', polarity: Polarity): 'good' | 'bad' | undefined {
  if (direction === 'flat' || polarity === 'neutral') return undefined;
  const rising = direction === 'up';
  return rising === (polarity === 'higher-better') ? 'good' : 'bad';
}

function Kpi({ spec, value, currency }: { spec: KpiSpec; value: KpiValue; currency: string }) {
  const display = value.kind === 'money' ? formatMoney(value.value, currency) : formatCount(value.value);
  const t = useT();
  const delta = computeDelta(value.value, value.previous);
  const arrow = delta?.direction === 'up' ? '↑' : delta?.direction === 'down' ? '↓' : '';
  return (
    <div className="kpi">
      <div className="kpi-label">{t(spec.label)}</div>
      <div className="kpi-value">{display}</div>
      {delta && (
        <div className="kpi-delta" data-tone={toneFor(delta.direction, spec.polarity)} title={t('Compared with the previous period')}>
          {arrow} {t(delta.label)}
        </div>
      )}
      {spec.note && <div className="kpi-note">{t(spec.note)}</div>}
    </div>
  );
}

// Derived from the period in the response, not from the selected range —
// while a new range loads, the previous figures stay on screen, and the
// heading has to describe the figures actually shown.
function periodLength(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function KpiSection({ days }: { days: number }) {
  const { data, error, isPending, isPlaceholderData, refetch } = useDashboardKpis(days);
  const t = useT();

  return (
    <section aria-labelledby="kpi-heading" aria-busy={isPlaceholderData}>
      <h2 id="kpi-heading" className="section-label">
        {data
          ? t('{from} – {to} · compared with the {days} days before', {
              from: formatDate(data.period.from),
              to: formatDate(data.period.to),
              days: periodLength(data.period.from, data.period.to),
            }) + (isPlaceholderData ? ` · ${t('updating…')}` : '')
          : t('Key figures')}
      </h2>
      {isPending ? (
        <div className="kpi-groups">
          {GROUPS.map((group) => (
            <div key={group.title} className="panel panel-body">
              <SkeletonLines lines={4} height={28} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : (
        <div className="kpi-groups" data-updating={isPlaceholderData}>
          {GROUPS.map((group) => (
            <div key={group.title} className="kpi-group">
              <div className="kpi-group-title">{t(group.title)}</div>
              {group.items.map((spec) => (
                <Kpi key={spec.key} spec={spec} value={data[spec.key]} currency={data.period.currency} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
