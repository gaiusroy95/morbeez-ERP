'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CollectionCard, CollectionsView, CustomerRecord } from '@morbeez/shared-types';
import { CreateBar, DayTabs, SearchFilter } from '@/components/redesign/ListCards';
import { initialsOf } from '@/components/redesign/Party';
import { CustomerPaymentDialog } from '@/components/forms/PaymentDialogs';
import { Field, FormDialog } from '@/components/ui/Form';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { useCollections } from '@/lib/hooks/use-money-stock';
import { useActiveCustomers, useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { useOpenOnNew } from '@/lib/hooks/use-open-on-new';
import { formatMoney } from '@/lib/format';
import { useI18n, useT } from '@/lib/i18n';

const VIEWS: { value: CollectionsView; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'pending', label: 'Pending' },
  { value: 'all', label: 'All' },
];

const STATUS: Record<CollectionCard['status'], { label: string; tone: 'done' | 'pending' | 'bad' }> = {
  paid: { label: 'Paid', tone: 'done' },
  partial: { label: 'Partial', tone: 'pending' },
  pending: { label: 'Pending', tone: 'bad' },
};

/** Choose who paid, then the usual payment form. */
function PickCustomer({ onPick, onClose }: { onPick: (c: CustomerRecord) => void; onClose: () => void }) {
  const t = useT();
  const customers = useActiveCustomers();
  const [id, setId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const choices = customers.records.filter((c) => !c.isWalkIn).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <FormDialog
      title={t('Add Collection')}
      description={<p>{t('Who paid? Then enter what they paid and how.')}</p>}
      submitLabel={t('Next')}
      pending={false}
      error={problem}
      onClose={onClose}
      onSubmit={() => {
        const chosen = choices.find((c) => c.id === id);
        if (!chosen) return setProblem(t('Choose the customer who paid.'));
        onPick(chosen);
      }}
    >
      <Field label={t('Customer')} wide>
        {(props) => (
          <select {...props} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{customers.isPending ? t('Loading…') : t('Choose a customer…')}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.place ? `${c.name} — ${c.place}` : c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
    </FormDialog>
  );
}

/**
 * Collections (client design V1.1, screen 14): what came in today, who
 * owes money that has fallen due, and every payment — each with what the
 * customer still owes. Collect records a payment; Add Collection asks who
 * paid first.
 */
export default function CollectionsPage() {
  const t = useT();
  const { lang } = useI18n();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const { data: session } = useSession();
  const canCollect = hasPermission(session, 'finance:collect');
  const [view, setView] = useState<CollectionsView>('today');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [paying, setPaying] = useState<{ id: string; name: string } | null>(null);
  useOpenOnNew(() => setPicking(true));
  const board = useCollections(view, query);
  const money = (v: string) => formatMoney(v, currency);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(`${lang}-IN`, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      ...(view === 'all' ? { day: 'numeric', month: 'short' } : {}),
    });

  return (
    <div className="list-screen" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('Collections')}</h1>
      {picking && (
        <PickCustomer
          onClose={() => setPicking(false)}
          onPick={(c) => {
            setPicking(false);
            setPaying({ id: c.id, name: c.name });
          }}
        />
      )}
      {paying && <CustomerPaymentDialog customerId={paying.id} customerName={paying.name} currency={currency} onClose={() => setPaying(null)} />}
      <DayTabs
        label="Which collections"
        value={view}
        onChange={setView}
        options={VIEWS.map((v) => ({ ...v, count: board.data?.counts[v.value] }))}
      />
      <SearchFilter value={query} onChange={setQuery} placeholder="Search customer…" />
      {board.data && (
        <div className="collection-totals">
          <span>
            {t('Collected today')} <strong>{money(board.data.totals.collectedToday)}</strong>
          </span>
          <span>
            {t('Due now')} <strong>{money(board.data.totals.dueNow)}</strong>
          </span>
        </div>
      )}
      {board.isPending ? (
        <SkeletonLines lines={5} height={64} />
      ) : board.error ? (
        <div className="panel">
          <ErrorState error={board.error} onRetry={() => board.refetch()} />
        </div>
      ) : (
        <div className="card-list" data-updating={board.isPlaceholderData || undefined}>
          {board.data.items.length === 0 && (
            <div className="list-empty">
              {query ? t('Nothing matches.') : view === 'pending' ? t('Nothing has fallen due.') : view === 'today' ? t('Nothing collected yet today.') : t('No payments yet.')}
            </div>
          )}
          {board.data.items.map((c) => {
            const status = STATUS[c.status];
            const owes = Number(c.balance) > 0;
            return (
              <div key={`${c.kind}-${c.id}`} className="collection-card">
                <span className="party-avatar" aria-hidden="true">
                  {initialsOf(c.customerName)}
                </span>
                <span className="party-main">
                  <span className="party-name">{c.customerName}</span>
                  {c.place && <span className="party-sub">{c.place}</span>}
                  <span className="collection-amount">{money(c.amount)}</span>
                </span>
                <span className="collection-side">
                  <span className="list-card-time">
                    {c.receivedAt
                      ? when(c.receivedAt)
                      : c.overdueDays
                        ? t(c.overdueDays === 1 ? 'Overdue {n} day' : 'Overdue {n} days', { n: c.overdueDays })
                        : t('Due today')}
                  </span>
                  <span className="list-card-status" data-tone={status.tone}>
                    {t(status.label)}
                  </span>
                  <span className="collection-balance" data-tone={owes ? 'bad' : undefined}>
                    {t('Bal: {amount}', { amount: money(c.balance) })}
                  </span>
                  {owes && canCollect ? (
                    <button type="button" className="button button-small" onClick={() => setPaying({ id: c.customerId, name: c.customerName })}>
                      {t('Collect')}
                    </button>
                  ) : (
                    <Link className="button button-small" href={`/customers?open=${c.customerId}`}>
                      {t('View')}
                    </Link>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {canCollect && <CreateBar label="Add Collection" onClick={() => setPicking(true)} />}
    </div>
  );
}
