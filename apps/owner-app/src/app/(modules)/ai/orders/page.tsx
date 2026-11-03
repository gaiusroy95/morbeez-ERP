'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { InboundMessage } from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { FilterTabs, PageHeader, Pager } from '@/components/ui/ListControls';
import { SuggestionCard } from '@/components/ai/Suggestions';
import { FreshButton, RunNote } from '@/components/ai/RunBar';
import { useIntegrations, useOpenSuggestions, useSuggestions, useWhatsAppMessages } from '@/lib/hooks/use-ai';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

type Tab = 'expected' | 'check' | 'whatsapp' | 'decided';

const MESSAGE: Record<InboundMessage['status'], { label: string; tone: Tone }> = {
  received: { label: 'Reading…', tone: 'active' },
  suggested: { label: 'On AI Orders', tone: 'done' },
  no_customer: { label: 'Unknown number', tone: 'attention' },
  no_order: { label: 'Not an order', tone: 'muted' },
  not_text: { label: 'Not text', tone: 'muted' },
  failed: { label: 'Couldn’t read', tone: 'bad' },
};

/**
 * AI Orders (owner Phase 8; first mockup set, screen 16; requirements Part 14
 * and 23): customers whose usual order for tomorrow hasn't come — place it
 * when they've told you, or ask them — and orders far from what a customer
 * usually takes, to confirm with them; and orders customers sent on WhatsApp,
 * read and checked against your products. The suggestion never places or
 * changes an order; you do, on the ordinary order (AI System DR.3).
 */
export default function AiOrdersPage() {
  const t = useT();
  const { data: session } = useSession();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [tab, setTab] = useState<Tab>('expected');
  const [page, setPage] = useState(1);
  const open = useOpenSuggestions('order');
  const decided = useSuggestions('decided', 'order', page, tab === 'decided');
  const items = open.data?.items ?? [];
  const expected = items.filter((r) => r.proposal.action === 'delivery_order');
  const check = items.filter((r) => r.proposal.action === 'confirm_order');
  const shown = tab === 'expected' ? expected : check;
  const permissions = session?.permissions ?? [];
  const integrations = useIntegrations();
  const whatsappOn = integrations.data?.whatsapp.receives ?? false;
  const messages = useWhatsAppMessages(whatsappOn || tab === 'whatsapp');

  return (
    <div className="stack">
      <PageHeader
        title="AI Orders"
        subtitle="Customers' usual orders that haven't come yet, and orders far from what a customer usually takes. You place or confirm — nothing changes until you do."
        actions={<FreshButton />}
      />
      <FilterTabs
        label={t('AI orders')}
        options={[
          { value: 'expected', label: `${t('Expected')} (${expected.length})` },
          { value: 'check', label: `${t('Check quantity')} (${check.length})` },
          { value: 'whatsapp', label: `${t('WhatsApp')} (${(messages.data ?? []).length})` },
          { value: 'decided', label: t('Decided') },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          setPage(1);
        }}
      />
      <RunNote type="order" />
      {tab === 'whatsapp' ? (
        <WhatsAppMessages on={whatsappOn} messages={messages.data} pending={messages.isPending} error={messages.error} onRetry={() => messages.refetch()} timeZone={timeZone} canRead={permissions.includes('ai:decide:customers')} />
      ) : tab === 'decided' ? (
        decided.isPending ? (
          <SkeletonLines lines={6} />
        ) : decided.error || !decided.data ? (
          <ErrorState error={decided.error} onRetry={() => decided.refetch()} />
        ) : decided.data.items.length === 0 ? (
          <p className="muted">{t('Nothing decided yet.')}</p>
        ) : (
          <>
            <div className="suggestions">
              {decided.data.items.map((r) => (
                <SuggestionCard key={r.id} rec={r} currency={currency} timeZone={timeZone} permissions={permissions} />
              ))}
            </div>
            <Pager page={decided.data.page} pageSize={decided.data.pageSize} total={decided.data.total} onPage={setPage} />
          </>
        )
      ) : open.isPending ? (
        <SkeletonLines lines={6} />
      ) : open.error ? (
        <ErrorState error={open.error} onRetry={() => open.refetch()} />
      ) : shown.length === 0 ? (
        <p className="muted">
          {t(tab === 'expected' ? 'No customer is expected to order who hasn’t yet.' : 'No order is far from what its customer usually takes.')}
        </p>
      ) : (
        <div className="suggestions">
          {shown.map((r) => (
            <SuggestionCard key={r.id} rec={r} currency={currency} timeZone={timeZone} permissions={permissions} />
          ))}
        </div>
      )}
    </div>
  );
}

function WhatsAppMessages({
  on,
  messages,
  pending,
  error,
  onRetry,
  timeZone,
  canRead,
}: {
  on: boolean;
  messages: InboundMessage[] | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  timeZone: string;
  canRead: boolean;
}) {
  const t = useT();
  const { data: session } = useSession();
  if (pending) return <SkeletonLines lines={6} />;
  if (error || !messages) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <>
      {!on && (
        <p className="muted">
          {t('WhatsApp orders aren’t set up on this server yet — see Settings → Integrations.')}{' '}
          {hasPermission(session, 'tenant:manage') && <Link href="/settings?tab=integrations">{t('Open Integrations')}</Link>}
        </p>
      )}
      {messages.length === 0 ? (
        <p className="muted">{t('No WhatsApp message has come in yet.')}</p>
      ) : (
        <ul className="wa-list">
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} timeZone={timeZone} canRead={canRead} />
          ))}
        </ul>
      )}
    </>
  );
}

function MessageRow({ m, timeZone, canRead }: { m: InboundMessage; timeZone: string; canRead: boolean }) {
  const t = useT();
  const again = useAction(() => apiSend<InboundMessage>('POST', `ai/whatsapp/messages/${m.id}/read-again`), [KEYS.ai]);
  const status = MESSAGE[m.status];
  const when = new Date(m.receivedAt).toLocaleString('en-IN', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <li className="wa-message" data-status={m.status}>
      <div className="wa-head">
        <span>
          <strong>{m.customerId ? <Link href={`/customers?open=${m.customerId}`}>{m.customerName}</Link> : (m.senderName ?? `+${m.fromPhone}`)}</strong>
          <span className="muted"> · +{m.fromPhone} · {when}</span>
        </span>
        <StatusBadge status={m.status} label={status.label} tone={status.tone} />
      </div>
      {m.body ? <p className="wa-body">{m.body}</p> : <p className="wa-body muted">{t('({type} message)', { type: m.messageType })}</p>}
      {(m.reader === 'sarvam' || m.reader === 'rules') && <p className="wa-note muted">{t(m.reader === 'sarvam' ? 'Read by Sarvam AI' : 'Read by simple rules')}</p>}
      {m.note && <p className="wa-note">{m.note}</p>}
      {m.repliedAt && <p className="wa-note muted">{t('Replied on WhatsApp with what was understood.')}</p>}
      {canRead && (m.status === 'no_customer' || m.status === 'failed' || m.status === 'no_order') && (
        <div>
          <button type="button" className="button button-small" disabled={again.isPending} onClick={() => again.mutate(undefined)}>
            {t('Read it again')}
          </button>
          {again.error ? <span className="form-error"> {(again.error as Error).message}</span> : null}
        </div>
      )}
    </li>
  );
}
