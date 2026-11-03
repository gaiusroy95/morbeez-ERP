'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CallItem, CallList, CallOutcome, CallPurpose, VoiceCall } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { Icon } from '@/components/ui/Icon';
import { Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { ContactActions, initialsOf, StatTiles } from '@/components/redesign/Party';
import { FreshButton } from '@/components/ai/RunBar';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useAiCalls, useVoiceCalls } from '@/lib/hooks/use-ai';
import { useActiveCustomers, useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';

const SECTIONS: { kind: CallItem['kind']; title: string; empty: string }[] = [
  { kind: 'payment', title: 'Payments to chase', empty: 'No money has fallen due.' },
  { kind: 'order', title: 'Orders to ask for', empty: 'Every customer expected tomorrow has ordered.' },
  { kind: 'new_order', title: 'New orders to confirm', empty: 'No order was placed in the last day.' },
  { kind: 'quantity', title: 'Quantities to confirm', empty: 'No order is far from what its customer usually takes.' },
];

const PURPOSE: Record<CallItem['kind'], CallPurpose> = { payment: 'payment_reminder', order: 'order_reminder', new_order: 'order_confirm', quantity: 'quantity_confirm' };

const PURPOSE_LABEL: Record<CallPurpose, string> = {
  payment_reminder: 'Payment reminder',
  order_reminder: "Tomorrow's order",
  order_confirm: 'New order confirmation',
  quantity_confirm: 'Quantity and price confirmation',
  follow_up: 'Follow-up',
};

/** What the agent reported. */
const OUTCOME: Record<CallOutcome, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmed', tone: 'done' },
  change_requested: { label: 'Wants changes', tone: 'attention' },
  will_pay: { label: 'Will pay', tone: 'done' },
  already_paid: { label: 'Says already paid', tone: 'attention' },
  call_later: { label: 'Call later', tone: 'attention' },
  not_interested: { label: 'Not interested', tone: 'muted' },
  wrong_person: { label: 'Wrong person', tone: 'bad' },
  no_decision: { label: 'No decision', tone: 'muted' },
};

const STATUS: Record<VoiceCall['status'], { label: string; tone: Tone }> = {
  queued: { label: 'Calling…', tone: 'active' },
  completed: { label: 'Finished', tone: 'done' },
  no_answer: { label: 'No answer', tone: 'attention' },
  busy: { label: 'Busy', tone: 'attention' },
  failed: { label: 'Failed', tone: 'bad' },
};

/** What the agent collected that's worth showing, in the order the owner acts on it. */
const DETAIL_LABEL: Record<string, string> = {
  requested_changes: 'Changes asked for',
  promised_payment_date: 'Promised to pay on',
  callback_time: 'Call back',
};

interface CallRequest {
  customerId: string;
  name: string;
  purpose: CallPurpose;
  recommendationId?: string;
  orderId?: string;
  topic?: string;
}

/**
 * AI Calling (owner Phase 8; first mockup set, screen 16; requirements
 * Part 21–23; the client: conversational AI, not press 1 / press 2): today's
 * calls — money fallen due (as Collections counts it), customers whose usual
 * order hasn't come, new orders, orders far from usual — and any customer to
 * follow up. With Sarvam's voice agent set up on the server and AI calls
 * turned on (Settings → Integrations), "Call with AI" has the agent ring
 * them and talk in their language; what came of it — the outcome, a summary,
 * what they asked for, the conversation — shows below. Nothing changes in the
 * books: placing a changed order or recording a payment stays yours.
 */
export default function AiCallingPage() {
  const t = useT();
  const currency = useCurrency();
  const list = useAiCalls();
  const voice = list.data?.voice;
  const history = useVoiceCalls(voice !== undefined && voice !== 'not_set_up');
  const calls = list.data?.calls ?? [];
  const [placing, setPlacing] = useState<CallRequest | null>(null);
  const [following, setFollowing] = useState(false);

  return (
    <div className="stack">
      <PageHeader
        title="AI Calling"
        subtitle="Today's calls, worked out from the books — call them yourself, or have the AI agent call them."
        actions={
          <>
            {voice === 'ready' && (
              <button type="button" className="button" onClick={() => setFollowing(true)}>
                {t('Follow-up call…')}
              </button>
            )}
            <FreshButton />
          </>
        }
      />
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
                        key={`${c.kind}-${c.customerId}-${c.recommendationId ?? c.orderId ?? ''}`}
                        c={c}
                        currency={currency}
                        onCall={
                          voice === 'ready' && c.phone && !c.doNotCall
                            ? () =>
                                setPlacing({
                                  customerId: c.customerId,
                                  name: c.name,
                                  purpose: PURPOSE[c.kind],
                                  recommendationId: c.recommendationId ?? undefined,
                                  orderId: c.orderId ?? undefined,
                                })
                            : null
                        }
                      />
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
          {voice !== 'not_set_up' && (
            <Panel title={t('AI calls (last 14 days)')}>
              {history.isPending ? (
                <SkeletonLines lines={3} />
              ) : history.error ? (
                <ErrorState error={history.error} onRetry={() => history.refetch()} />
              ) : (history.data ?? []).length === 0 ? (
                <p className="muted">{t('No AI call has been placed yet.')}</p>
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
      {placing && <PlaceCallDialog request={placing} onClose={() => setPlacing(null)} />}
      {following && (
        <FollowUpDialog
          onPick={(r) => {
            setFollowing(false);
            setPlacing(r);
          }}
          onClose={() => setFollowing(false)}
        />
      )}
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
        <h2 id="voice-state">{t(voice === 'ready' ? 'AI calls are on' : voice === 'off' ? 'AI calls are off' : 'AI calls aren’t set up')}</h2>
        <p className="muted">
          {voice === 'ready'
            ? t('The AI agent rings the customer and talks with them in their language — the amount due, their order, your question — and listens to what they say. What came of it shows below. Nothing is changed in your books.')
            : voice === 'off'
              ? t('This server can place AI calls, but they are turned off for your business.')
              : t('AI calls need Sarvam’s voice agent set up on the server (apps/backend/.env.example, section 4d). Until then, call them yourself from here.')}{' '}
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
      : c.kind === 'new_order'
        ? `${c.about ?? ''}${c.amount ? ` · ${formatMoney(c.amount, currency)}` : ''}`
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
        {c.doNotCall && <StatusBadge status="do_not_call" label="Do not call" tone="muted" />}
        {onCall && (
          <button type="button" className="button button-small button-primary" onClick={onCall}>
            <Icon name="sparkles" size={16} /> {t('Call with AI')}
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

/** Whom to follow up and about what — then the same preview as any call. */
function FollowUpDialog({ onPick, onClose }: { onPick: (r: CallRequest) => void; onClose: () => void }) {
  const t = useT();
  const customers = useActiveCustomers().records.filter((c) => !c.isWalkIn);
  const [customerId, setCustomerId] = useState('');
  const [topic, setTopic] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FormDialog
      title={t('Follow-up call')}
      description={<p>{t('The AI agent calls the customer about what you write here, in their language, and tells you what they said.')}</p>}
      submitLabel={t('Next')}
      pending={false}
      error={problem}
      onClose={onClose}
      onSubmit={() => {
        const c = customers.find((x) => x.id === customerId);
        if (!c) return setProblem(t('Choose the customer.'));
        if (c.doNotCall) return setProblem(t('{name} is marked Do Not Call.', { name: c.name }));
        if (topic.trim().length < 3) return setProblem(t('Say what the call is about.'));
        onPick({ customerId: c.id, name: c.name, purpose: 'follow_up', topic: topic.trim() });
      }}
    >
      <Field label="Customer" wide>
        {(props) => (
          <select {...props} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id} disabled={c.doNotCall}>
                {c.name}
                {c.doNotCall ? ` — ${t('Do not call')}` : ''}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="What should the agent talk about?" wide>
        {(props) => (
          <textarea
            {...props}
            maxLength={500}
            value={topic}
            placeholder={t('Ask how the last delivery of onions was, and whether they want the same next week.')}
            onChange={(e) => setTopic(e.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

/** What the agent will be told, then place it. */
function PlaceCallDialog({ request, onClose }: { request: CallRequest; onClose: () => void }) {
  const t = useT();
  const { name, ...body } = request;
  const [preview, setPreview] = useState<{ text: string; language: string; toPhone: string | null } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  useEffect(() => {
    apiSend<{ text: string; language: string; toPhone: string | null }>('POST', 'ai/calls/voice/preview', body).then(setPreview, setPreviewError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const run = useAction(() => apiSend<VoiceCall>('POST', 'ai/calls/voice', body), [KEYS.ai], onClose);
  return (
    <FormDialog
      title={t('Call {name} with AI?', { name })}
      description={<p>{t('{purpose} — the AI agent is told this, and talks with them about it in their language:', { purpose: t(PURPOSE_LABEL[request.purpose]) })}</p>}
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
  const outcome = call.outcome ? OUTCOME[call.outcome] : null;
  const when = new Date(call.createdAt).toLocaleString('en-IN', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const details = Object.entries(DETAIL_LABEL)
    .map(([key, label]) => [label, call.details?.[key]] as const)
    .filter((d): d is readonly [string, string] => typeof d[1] === 'string' && d[1].trim() !== '' && d[1].trim().toLowerCase() !== 'na');
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
        {call.summary && <p className="call-summary">{call.summary}</p>}
        {details.length > 0 && (
          <dl className="call-details">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {call.error && <p className="muted">{call.error}</p>}
        {call.transcript && call.transcript.length > 0 && (
          <details className="call-transcript">
            <summary>{t('Conversation ({n} turns)', { n: call.transcript.length })}</summary>
            <ol>
              {call.transcript.map((turn, i) => (
                <li key={i} data-role={turn.role}>
                  <strong>{t(turn.role === 'agent' ? 'Agent' : 'Customer')}:</strong> {turn.text}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
      <div className="call-actions">
        <StatusBadge status={call.status} label={status.label} tone={status.tone} />
        {outcome && <StatusBadge status={call.outcome!} label={outcome.label} tone={outcome.tone} />}
      </div>
    </li>
  );
}
