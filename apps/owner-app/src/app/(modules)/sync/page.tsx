'use client';

import Link from 'next/link';
import type { DriverPhones, PhoneReport, PhoneState } from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ContactActions, initialsOf, StatTiles } from '@/components/redesign/Party';
import { useSyncStatus } from '@/lib/hooks/use-devices';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { formatDateTime } from '@/lib/format';
import { useT, type Translate } from '@/lib/i18n';

const STATE: Record<PhoneState, { label: string; tone: 'bad' | 'attention' | 'done' | 'muted' }> = {
  stuck: { label: 'Stuck', tone: 'bad' },
  quiet: { label: 'Not heard from', tone: 'attention' },
  waiting: { label: 'Waiting to send', tone: 'attention' },
  synced: { label: 'Synced', tone: 'done' },
  never: { label: 'No report yet', tone: 'muted' },
};
const ORDER: PhoneState[] = ['stuck', 'quiet', 'waiting', 'synced', 'never'];

/** What each queued action is, as the driver's Sync screen names it. */
const ACTION: Record<string, string> = {
  START_TRIP: 'Start day',
  ARRIVE_STOP: 'Arrived at a stop',
  START_DELIVERIES: 'Start trip',
  COMPLETE_PICKUP_STOP: 'Farm stop',
  COMPLETE_DELIVERY_STOP: 'Delivery',
  SKIP_STOP: 'Skipped stop',
  RECORD_EXPENSE: 'Expense',
  RECORD_COLLECTION: 'Collection',
  RECORD_DEPOSIT: 'Bank deposit',
  RETURN_TRIP: 'Return',
  RAISE_DISPUTE: 'Dispute',
  SUBMIT_TRIP: 'Cash handover',
  REPORT_PROBLEM: 'Problem report',
  CREATE_BACKHAUL: 'New backhaul',
  ACCEPT_BACKHAUL: 'Backhaul accepted',
  SKIP_BACKHAUL: 'Backhaul skipped',
  BACKHAUL_STEP: 'Backhaul step',
  PAY_BACKHAUL: 'Backhaul payment',
  ACKNOWLEDGE_PAY: 'Pay received',
  SEND_MESSAGE: 'Message to the office',
  READ_CHAT: 'Messages read',
};

/** "12 min ago", "3 h ago", "2 days ago". */
function ago(iso: string, now: number, t: Translate): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  if (minutes < 48 * 60) return t('{n} h ago', { n: Math.round(minutes / 60) });
  return t('{n} days ago', { n: Math.round(minutes / 1440) });
}

/**
 * Driver phones (owner Phase 8; first mockup set, screen 24 — Offline
 * sync). A driver's phone keeps every action until the server has it, and
 * reports after each sync what's still on it and what the server refused.
 * Here: each driver's phone, the stuck first, with the server's own words.
 */
export default function DriverPhonesPage() {
  const t = useT();
  const status = useSyncStatus();
  const drivers = [...(status.data?.drivers ?? [])].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  const count = (s: PhoneState) => drivers.filter((d) => d.state === s).length;

  return (
    <div className="stack">
      <PageHeader title="Driver phones" subtitle="Each phone keeps the driver's work until it reaches us, and reports after every sync: what's still on it, and anything we refused." />
      {status.isPending ? (
        <SkeletonLines lines={8} />
      ) : status.error || !status.data ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : (
        <>
          <StatTiles
            items={[
              { label: 'Stuck', value: count('stuck'), tone: count('stuck') ? 'bad' : undefined },
              { label: 'Waiting or not heard from', value: count('waiting') + count('quiet') },
              { label: 'Synced', value: count('synced'), tone: 'good' },
              { label: 'No report yet', value: count('never') },
            ]}
          />
          {drivers.length === 0 ? (
            <p className="muted">{t('No active drivers.')}</p>
          ) : (
            <div className="phone-cards">
              {drivers.map((d) => (
                <DriverCard key={d.employeeId} d={d} asOf={new Date(status.data.asOf).getTime()} quietAfter={status.data.quietAfterMinutes} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DriverCard({ d, asOf, quietAfter }: { d: DriverPhones; asOf: number; quietAfter: number }) {
  const t = useT();
  const s = STATE[d.state];
  return (
    <article className="phone-card" data-state={d.state} aria-labelledby={`driver-${d.employeeId}`}>
      <header className="phone-card-head">
        <span className="party-avatar" aria-hidden="true">
          {initialsOf(d.name)}
        </span>
        <div className="phone-card-who">
          <strong id={`driver-${d.employeeId}`}>{d.name}</strong>
          {d.onTrip ? (
            <Link className="chat-trip-chip" href={`/logistics?open=${d.onTrip.id}`}>
              {t('On trip {n}', { n: d.onTrip.number })}
            </Link>
          ) : (
            <span className="muted">{t('Not on a trip')}</span>
          )}
        </div>
        <StatusBadge status={d.state} tone={s.tone} label={s.label} />
      </header>
      {d.devices.length === 0 ? (
        <p className="muted">{t('This driver’s phone hasn’t reported yet — it does after the app’s first sync.')}</p>
      ) : (
        d.devices.map((p) => <Phone key={p.deviceId} p={p} asOf={asOf} quietAfter={quietAfter} several={d.devices.length > 1} />)
      )}
      <footer className="phone-card-foot">
        <ContactActions phone={d.phone} pin={null} address={null} navigate={false} />
        <Link className="button button-small" href={`/chat?driver=${d.employeeId}`}>
          {t('Message')}
        </Link>
      </footer>
    </article>
  );
}

function Phone({ p, asOf, quietAfter, several }: { p: PhoneReport; asOf: number; quietAfter: number; several: boolean }) {
  const t = useT();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  return (
    <div className="phone-report">
      <p>
        <span title={formatDateTime(p.reportedAt, timeZone)}>{t('Last synced {when}', { when: ago(p.reportedAt, asOf, t) })}</span>
        <span className="muted">
          {' · '}
          {t('app {v}', { v: p.appVersion })}
          {several ? ` · ${p.deviceId.slice(0, 8)}` : ''}
        </span>
      </p>
      {p.state === 'quiet' && <p className="muted">{t('Nothing from this phone for over {n} hours — off, no signal, or the app closed.', { n: Math.round(quietAfter / 60) })}</p>}
      {p.pendingOperations + p.pendingPhotos > 0 ? (
        <p>
          {t('Still on the phone: {what}', {
            what: [
              p.pendingOperations ? t(p.pendingOperations === 1 ? '1 action' : '{n} actions', { n: p.pendingOperations }) : null,
              p.pendingPhotos ? t(p.pendingPhotos === 1 ? '1 photo' : '{n} photos', { n: p.pendingPhotos }) : null,
            ]
              .filter(Boolean)
              .join(', '),
          })}
          {p.oldestPendingAt && <span className="muted"> · {t('the oldest from {when}', { when: ago(p.oldestPendingAt, asOf, t) })}</span>}
        </p>
      ) : (
        <p className="muted">{t('Nothing waiting on the phone.')}</p>
      )}
      {p.failures.length > 0 && (
        <ul className="phone-failures" aria-label={t('Refused')}>
          {p.failures.map((f, i) => (
            <li key={i}>
              <strong>{t(ACTION[f.type] ?? f.type)}</strong> — {f.error || t('refused, no reason given')}
            </li>
          ))}
        </ul>
      )}
      {p.failedPhotos > 0 && <p className="phone-failures">{t(p.failedPhotos === 1 ? '1 photo refused' : '{n} photos refused', { n: p.failedPhotos })}</p>}
    </div>
  );
}
