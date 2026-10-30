'use client';

import Link from 'next/link';
import type { CallItem } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { Icon } from '@/components/ui/Icon';
import { ContactActions, initialsOf, StatTiles } from '@/components/redesign/Party';
import { FreshButton } from '@/components/ai/RunBar';
import { useAiCalls } from '@/lib/hooks/use-ai';
import { useCurrency } from '@/lib/hooks/use-lookups';
import { formatDate, formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';

const SECTIONS: { kind: CallItem['kind']; title: string; empty: string }[] = [
  { kind: 'payment', title: 'Payments to chase', empty: 'No money has fallen due.' },
  { kind: 'order', title: 'Orders to ask for', empty: 'Every customer expected tomorrow has ordered.' },
  { kind: 'quantity', title: 'Quantities to confirm', empty: 'No order is far from what its customer usually takes.' },
];

/**
 * AI Calling (owner Phase 8; first mockup set, screen 16; requirements
 * Part 21–23). AI voice calls — taking orders, payment reminders, delivery
 * confirmations — are a later part of the plan and aren't built. Until then
 * this is today's call list, worked out the same way, for you to make:
 * money fallen due (as Collections counts it), customers whose usual order
 * hasn't come, orders to confirm.
 */
export default function AiCallingPage() {
  const t = useT();
  const currency = useCurrency();
  const list = useAiCalls();
  const calls = list.data?.calls ?? [];

  return (
    <div className="stack">
      <PageHeader title="AI Calling" subtitle="Today's calls. AI voice calling is coming; until then, call them from here." actions={<FreshButton />} />
      <section className="coming-card" aria-labelledby="voice-coming">
        <Icon name="phone" size={22} />
        <div>
          <h2 id="voice-coming">{t('AI voice calls — coming')}</h2>
          <p className="muted">
            {t('The AI will call customers itself: to take and confirm orders, remind them of payments due, and confirm deliveries — always within your rules, and you hear what was said. It isn’t switched on yet; the list below is who it would call today.')}
          </p>
        </div>
      </section>
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
                      <CallRow key={`${c.kind}-${c.customerId}-${c.recommendationId ?? ''}`} c={c} currency={currency} />
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </>
      )}
    </div>
  );
}

function CallRow({ c, currency }: { c: CallItem; currency: string }) {
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
        {c.recommendationId && (
          <Link className="button button-small" href="/ai/orders">
            {t('Open in AI Orders')}
          </Link>
        )}
      </div>
    </li>
  );
}
