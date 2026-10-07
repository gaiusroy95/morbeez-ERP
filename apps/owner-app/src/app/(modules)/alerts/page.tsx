'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { EveningSummary, OwnerAlert } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader } from '@/components/ui/ListControls';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useAlerts, useEveningSummary } from '@/lib/hooks/use-delegation';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

const SUBTITLE = 'Exceptions reach you the moment they happen. Everything normal waits for the evening summary.';

const KIND_LABEL: Record<OwnerAlert['kind'], string> = {
  cash_mismatch: 'Cash mismatch',
  collection_discrepancy: 'Collection short',
  inventory_mismatch: 'Stock mismatch',
  customer_rejection: 'Customer rejection',
  procurement_issue: 'Procurement',
  driver_unable_to_continue: "Driver can't continue",
  trip_blocked: "Trip can't proceed",
  operational_problem: 'On the road',
  security: 'Security',
};

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank', cheque: 'Cheque' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function AlertList({ alerts, timeZone }: { alerts: OwnerAlert[]; timeZone: string }) {
  const t = useT();
  const read = useAction((id: string) => apiSend('POST', `alerts/${id}/read`), [KEYS.alerts]);
  if (alerts.length === 0) return <p className="muted">{t('Nothing needs you. Quiet is good.')}</p>;
  return (
    <ul className="owner-alerts">
      {alerts.map((a) => (
        <li key={a.id} className="alert-item" data-severity={a.severity} data-read={a.readAt ? true : undefined}>
          <div className="alert-main">
            <div className="alert-head">
              <StatusBadge status={a.kind} tone={a.severity === 'critical' ? 'bad' : 'attention'} label={KIND_LABEL[a.kind]} />
              <span className="alert-time">{formatDateTime(a.createdAt, timeZone)}</span>
            </div>
            <strong className="alert-title">{a.title}</strong>
            <span className="alert-detail">{a.detail}</span>
            {a.tripId && (
              <Link className="owner-alert-link" href="/logistics">
                {t('Go to trips')}
              </Link>
            )}
          </div>
          {!a.readAt && (
            <button type="button" className="button button-ghost" onClick={() => read.mutate(a.id)} disabled={read.isPending}>
              {t('Seen')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Figure({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="summary-figure">
      <span className="summary-label">{label}</span>
      <strong className="summary-value">{value}</strong>
      {note && <span className="summary-note">{note}</span>}
    </div>
  );
}

function Summary({ s, currency }: { s: EveningSummary; currency: string }) {
  const t = useT();
  const money = (v: string) => formatMoney(v, currency);
  return (
    <div className="stack">
      {s.ownerAway && <p className="summary-away">{t('You were away today — this is what your backup driver did.')}</p>}
      <div className="summary-grid">
        <Figure
          label={t('Procurement')}
          value={s.procurement.quantity.length ? s.procurement.quantity.map((q) => formatQuantity(q.quantity, q.uom)).join(' · ') : '—'}
          note={s.procurement.lots ? `${plural(s.procurement.lots, 'lot')}, ${money(s.procurement.cost)}` : 'Nothing bought'}
        />
        <Figure
          label={t('Deliveries')}
          value={s.deliveries.done}
          note={`${plural(s.deliveries.customers, 'customer')}${s.deliveries.notDelivered ? ` · ${s.deliveries.notDelivered} not delivered` : ''}`}
        />
        <Figure
          label={t('Collections')}
          value={money(s.collections.total)}
          note={s.collections.byMethod.map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${money(m.amount)}`).join(' · ') || 'None'}
        />
        <Figure label={t('Spot sales')} value={money(s.spotSales.total)} note={plural(s.spotSales.count, 'sale')} />
        <Figure
          label={t('Expenses')}
          value={money(s.expenses)}
          note={Number(s.bankDeposits) ? `${money(s.bankDeposits)} paid into the bank on the road` : undefined}
        />
        <Figure
          label={t('Trips')}
          value={`${s.trips.started} out · ${s.trips.closed} closed`}
          note={`${s.trips.open} still open${s.closures.withException ? ` · ${s.closures.withException} closed with an exception` : ''}`}
        />
      </div>
      <div className="split-even">
        <div>
          <h3 className="detail-subhead">{t('Drivers')}</h3>
          {s.drivers.length === 0 ? (
            <p className="muted">{t('No one was on the road.')}</p>
          ) : (
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>{t('Driver')}</th>
                  <th className="num">{t('Stops')}</th>
                  <th className="num">{t('Collected')}</th>
                  <th className="num">{t('Spent')}</th>
                </tr>
              </thead>
              <tbody>
                {s.drivers.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="num">{d.stopsDone}</td>
                    <td className="num">{money(d.collected)}</td>
                    <td className="num">{money(d.expenses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="detail-subhead">{t('Still in stock')}</h3>
          {s.remaining.length === 0 ? (
            <p className="muted">{t('Nothing left on hand.')}</p>
          ) : (
            <table className="table table-compact">
              <tbody>
                {s.remaining.map((r) => (
                  <tr key={r.product}>
                    <td>{r.product}</td>
                    <td className="num">{formatQuantity(r.quantity, r.uom)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div>
        <h3 className="detail-subhead">Exceptions this day ({s.exceptions.length})</h3>
        {s.exceptions.length === 0 ? (
          <p className="muted">{t('None — a normal day.')}</p>
        ) : (
          <ul className="summary-exceptions">
            {s.exceptions.map((e) => (
              <li key={e.id}>{e.title}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const t = useT();
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const currency = useCurrency();
  const [view, setView] = useState<'new' | 'everything'>('new');
  const [date, setDate] = useState<string | undefined>(undefined);
  const alerts = useAlerts(view === 'new');
  const summary = useEveningSummary(date);
  const readAll = useAction(() => apiSend('POST', 'alerts/read-all'), [KEYS.alerts]);

  if (session && !hasPermission(session, 'dashboard:read')) {
    return (
      <div className="stack">
        <PageHeader title={t('Alerts & summary')} subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>{t("Your role doesn't include the owner's alerts.")}</strong>
        </div>
      </div>
    );
  }

  const day = summary.data ? new Date(`${summary.data.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : '';

  return (
    <div className="stack">
      <PageHeader
        title={t('Alerts & summary')}
        subtitle={SUBTITLE}
        actions={
          view === 'new' &&
          (alerts.data?.length ?? 0) > 0 && (
            <button type="button" className="button" onClick={() => readAll.mutate(undefined)} disabled={readAll.isPending}>
              {t('Mark all seen')}
            </button>
          )
        }
      />
      <Panel
        title={t('Alerts')}
        meta={
          <FilterTabs
            label={t('Which alerts')}
            options={[
              { value: 'new', label: 'New' },
              { value: 'everything', label: 'Everything' },
            ]}
            value={view}
            onChange={(v) => setView(v === 'everything' ? 'everything' : 'new')}
          />
        }
      >
        {alerts.isPending ? (
          <SkeletonLines lines={4} />
        ) : alerts.error ? (
          <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
        ) : (
          <AlertList alerts={alerts.data ?? []} timeZone={timeZone} />
        )}
      </Panel>
      <Panel
        title={day ? `Evening summary · ${day}` : 'Evening summary'}
        meta={
          <input
            type="date"
            className="input-compact"
            aria-label={t('Day')}
            value={date ?? summary.data?.date ?? ''}
            onChange={(e) => setDate(e.target.value || undefined)}
          />
        }
      >
        {summary.isPending ? (
          <SkeletonLines lines={6} />
        ) : summary.error || !summary.data ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        ) : (
          <div className="updating" data-updating={summary.isPlaceholderData || undefined}>
            <Summary s={summary.data} currency={currency} />
          </div>
        )}
      </Panel>
    </div>
  );
}
