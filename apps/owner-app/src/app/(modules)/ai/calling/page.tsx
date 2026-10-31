'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CallItem, CallList, CallPurpose, VoiceCall } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { Icon } from '@/components/ui/Icon';
import { FormDialog } from '@/components/ui/Form';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { ContactActions, initialsOf, StatTiles } from '@/components/redesign/Party';
import { FreshButton } from '@/components/ai/RunBar';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useAiCalls, useVoiceCalls } from '@/lib/hooks/use-ai';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';

const SECTIONS: { kind: CallItem['kind']; title: string; empty: string }[] = [
  { kind: 'payment', title: 'Payments to chase', empty: 'No money has fallen due.' },
  { kind: 'order', title: 'Orders to ask for', empty: 'Every customer expected tomorrow has ordered.' },
  { kind: 'quantity', title: 'Quantities to confirm', empty: 'No order is far from what its customer usually takes.' },
];

const PURPOSE: Record<CallItem['kind'], CallPurpose> = { payment: 'payment_reminder', order: 'order_reminder', quantity: 'order_confirm' };

const PURPOSE_LABEL: Record<CallPurpose, string> = {
  payment_reminder: 'Payment reminder',
  order_reminder: 'Usual order',
  order_confirm: 'Order to confirm',
};

/** What the customer's key meant, for each kind of call. */
const OUTCOME: Record<CallPurpose, Record<NonNullable<VoiceCall['outcome']>, { label: string; tone: Tone }>> = {
  payment_reminder: {
    confirmed: { label: 'Pressed 1 — will pay today', tone: 'done' },
    callback: { label: 'Pressed 2 — call them back', tone: 'attention' },
    no_response: { label: 'Answered, pressed nothing', tone: 'muted' },
  },
  order_reminder: {
    confirmed: { label: 'Pressed 1 — send the usual order', tone: 'done' },
    callback: { label: 'Pressed 2 — call them back', tone: 'attention' },
    no_response: { label: 'Answered, pressed nothing', tone: 'muted' },
  },
  order_confirm: {
    confirmed: { label: 'Pressed 1 — the order is right', tone: 'done' },
    callback: { label: 'Pressed 2 — call them to change it', tone: 'attention' },
    no_response: { label: 'Answered, pressed nothing', tone: 'muted' },
  },
};

const STATUS: Record<VoiceCall['status'], { label: string; tone: Tone }> = {
  queued: { label: 'Dialling', tone: 'active' },
  ringing: { label: 'Ringing', tone: 'active' },
  in_progress: { label: 'On the call', tone: 'active' },
  completed: { label: 'Finished', tone: 'done' },
  busy: { label: 'Busy', tone: 'attention' },
  no_answer: { label: 'No answer', tone: 'attention' },
  failed: { label: 'Failed', tone: 'bad' },
  canceled: { label: 'Cancelled', tone: 'muted' },
};

/**
 * AI Calling (owner Phase 8; first mockup set, screen 16; requirements
 * Part 21–23): today's call list — money fallen due (as Collections counts
 * it), customers whose usual order hasn't come, orders to confirm. With
 * Twilio set up on the server and automated calls turned on (Settings →
 * Integrations), Call places an automated call in the customer's language:
 * it says the amount or the order and asks them to press 1 or 2, and what
 * they pressed shows below. It records the answer; it changes nothing.
 */
export default function AiCallingPage() {
  const t = useT();
  const currency = useCurrency();
  const list = useAiCalls();
  const voice = list.data?.voice;
  const history = useVoiceCalls(voice !== undefined && voice !== 'not_set_up');
  const calls = list.data?.calls ?? [];
  const [placing, setPlacing] = useState<CallItem | null>(null);

  return (
    <div className="stack">
      <PageHeader title="AI Calling" subtitle="Today's calls, worked out from the books — call them yourself, or have them called automatically." actions={<FreshButton />} />
      {voice && <VoiceCard voice={voice} />}
      {list.isPending ? (
        <SkeletonLines lines={8} />
      ) : list.error || !list.data ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <>
          <StatTiles items={SECTIONS.map((s) => ({ label: s.title, value: calls.filter((c) => c.kind === s.kind).length }))} />
          {SECTIONS.map((s) => {
            const rows = calls.filter((c) => c.kind === s.kind);
            return (
              <Panel key={s.kind} title={`${t(s.title)} (${rows.length})`}>
                {rows.length === 0 ? (
                  <p className="muted">{t(s.empty)}</p>
                ) : (
                  <ul className="call-list">
                    {rows.map((c) => (
                      <CallRow
                        key={`${c.kind}-${c.customerId}-${c.recommendationId ?? ''}`}
                        c={c}
                        currency={currency}
                        onCall={voice === 'ready' && c.phone ? () => setPlacing(c) : null}
                      />
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
          {voice !== 'not_set_up' && (
            <Panel title={t('Automated calls (last 14 days)')}>
              {history.isPending ? (
                <SkeletonLines lines={3} />
              ) : history.error ? (
                <ErrorState error={history.error} onRetry={() => history.refetch()} />
              ) : (history.data ?? []).length === 0 ? (
                <p className="muted">{t('No automated call has been placed yet.')}</p>
              ) : (
                <ul className="call-list">
                  {(history.data ?? []).map((call) => (
                    <PlacedCall key={call.id} call={call} />
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}
      {placing && <PlaceCallDialog item={placing} onClose={() => setPlacing(null)} />}
    </div>
  );
}

function VoiceCard({ voice }: { voice: CallList['voice'] }) {
  const t = useT();
  const { data: session } = useSession();
  return (
    <section className="coming-card" data-state={voice} aria-labelledby="voice-state">
      <Icon name="phone" size={22} />
      <div>
        <h2 id="voice-state">{t(voice === 'ready' ? 'Automated calls are on' : voice === 'off' ? 'Automated calls are off' : 'Automated calls aren’t set up')}</h2>
        <p className="muted">
          {voice === 'ready'
            ? t('Call rings the customer and speaks in their language: the amount due, or the order. They press 1 for yes or 2 to be called back, and the answer shows below. Nothing is changed in your books.')
            : voice === 'off'
              ? t('This server can place calls, but they are turned off for your business.')
              : t('Automated calls need a Twilio account on the server (apps/backend/.env.example, section 4d). Until then, call them yourself from here.')}{' '}
          {voice === 'off' && hasPermission(session, 'tenant:manage') && <Link href="/settings?tab=integrations">{t('Turn them on in Settings → Integrations')}</Link>}
        </p>
      </div>
    </section>
  );
}

function CallRow({ c, currency, onCall }: { c: CallItem; currency: string; onCall: (() => void) | null }) {
  const t = useT();
  const why =
    c.kind === 'payment'
      ? c.overdueDays && c.overdueDays > 0
        ? t('{amount} fallen due — {n} days overdue (since {date})', { amount: formatMoney(c.amount ?? '0', currency), n: c.overdueDays, date: formatDate(c.dueDate ?? '') })
        : t('{amount} due today', { amount: formatMoney(c.amount ?? '0', currency) })
      : c.about;
  return (
    <li className="call-row">
      <span className="party-avatar" aria-hidden="true">
        {initialsOf(c.name)}
      </span>
      <div className="call-main">
        <strong>
          <Link href={`/customers?open=${c.customerId}`}>{c.name}</Link>
        </strong>
        {c.place && <span className="muted"> · {c.place}</span>}
        <p className="call-why">{why}</p>
        {!c.phone && <p className="muted">{t('No phone number on their profile.')}</p>}
      </div>
      <div className="call-actions">
        <ContactActions phone={c.phone} pin={null} address={c.place} />
        {onCall && (
          <button type="button" className="button button-small button-primary" onClick={onCall}>
            <Icon name="sparkles" size={16} /> {t('Call automatically')}
          </button>
        )}
        {c.recommendationId && (
          <Link className="button button-small" href="/ai/orders">
            {t('Open in AI Orders')}
          </Link>
        )}
      </div>
    </li>
  );
}

/** What the call will say, then place it. */
function PlaceCallDialog({ item, onClose }: { item: CallItem; onClose: () => void }) {
  const t = useT();
  const body = { customerId: item.customerId, purpose: PURPOSE[item.kind], recommendationId: item.recommendationId ?? undefined };
  const [preview, setPreview] = useState<{ text: string; toPhone: string | null } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  useEffect(() => {
    apiSend<{ text: string; toPhone: string | null }>('POST', 'ai/calls/voice/preview', body).then(setPreview, setPreviewError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.customerId, item.kind, item.recommendationId]);
  const run = useAction(() => apiSend<VoiceCall>('POST', 'ai/calls/voice', body), [KEYS.ai], onClose);
  return (
    <FormDialog
      title={t('Call {name} automatically?', { name: item.name })}
      description={<p>{t('{purpose} — the call says this, in their language, and asks for one key:', { purpose: t(PURPOSE_LABEL[PURPOSE[item.kind]]) })}</p>}
      submitLabel={t('Place the call')}
      pending={run.isPending}
      error={previewError ?? run.error}
      onClose={onClose}
      onSubmit={() => preview && run.mutate(undefined)}
    >
      {preview ? (
        <blockquote className="call-preview">
          {preview.text}
          {preview.toPhone && <footer className="muted">{t('To {phone}', { phone: preview.toPhone })}</footer>}
        </blockquote>
      ) : (
        !previewError && <SkeletonLines lines={2} />
      )}
    </FormDialog>
  );
}

function PlacedCall({ call }: { call: VoiceCall }) {
  const t = useT();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const status = STATUS[call.status];
  const outcome = call.outcome ? OUTCOME[call.purpose][call.outcome] : null;
  const when = new Date(call.createdAt).toLocaleString('en-IN', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <li className="call-row" data-call={call.status}>
      <span className="party-avatar" aria-hidden="true">
        {initialsOf(call.customerName)}
      </span>
      <div className="call-main">
        <strong>
          <Link href={`/customers?open=${call.customerId}`}>{call.customerName}</Link>
        </strong>
        <span className="muted"> · {t(PURPOSE_LABEL[call.purpose])}</span>
        <p className="call-why">
          {when}
          {call.durationSeconds ? ` · ${t('{n} s', { n: call.durationSeconds })}` : ''}
          {call.requestedBy ? ` · ${t('by {name}', { name: call.requestedBy })}` : ''}
        </p>
        {call.error && <p className="muted">{call.error}</p>}
      </div>
      <div className="call-actions">
        <StatusBadge status={call.status} label={status.label} tone={status.tone} />
        {outcome && <StatusBadge status={call.outcome!} label={outcome.label} tone={outcome.tone} />}
      </div>
    </li>
  );
}
