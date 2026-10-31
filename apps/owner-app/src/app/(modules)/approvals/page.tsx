'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { DriverRequestKind, InboxItem, InboxKind, InboxTab } from '@morbeez/shared-types';
import { DayTabs } from '@/components/redesign/ListCards';
import { Field, FormDialog } from '@/components/ui/Form';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useApprovalsInbox, useDriverRequest } from '@/lib/hooks/use-admin';
import { useCurrency } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatMoney } from '@/lib/format';
import { useT, type Translate } from '@/lib/i18n';

const KIND: Record<InboxKind, { title: string; icon: IconName }> = {
  expense: { title: 'Expense approval', icon: 'receipt' },
  purchase_order: { title: 'Purchase order approval', icon: 'basket' },
  customer_order: { title: 'Delivery order approval', icon: 'users' },
  spot_price: { title: 'Spot sale price', icon: 'bolt' },
  ai: { title: 'AI suggestion', icon: 'sparkles' },
  dispute: { title: 'Customer dispute', icon: 'alert' },
  trip_close: { title: 'Trip to close', icon: 'truck' },
  driver_request: { title: 'Driver request', icon: 'steering' },
};

/** A driver's request (D10): what it's called, and who may decide it — whoever may already do the thing it does. */
const REQUEST: Record<DriverRequestKind, { title: string; permission: string }> = {
  advance: { title: 'Advance request', permission: 'payroll:prepare' },
  new_customer: { title: 'New customer request', permission: 'customers:write' },
  credit_limit: { title: 'Credit limit request', permission: 'customers:credit' },
};

const titleOf = (item: InboxItem) =>
  item.kind === 'driver_request' && item.refs.requestKind
    ? REQUEST[item.refs.requestKind].title
    : item.kind === 'ai' && item.tab === 'price'
      ? 'Price change suggestion'
      : KIND[item.kind].title;

const TABS: { value: InboxTab | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expense' },
  { value: 'price', label: 'Price' },
  { value: 'other', label: 'Other' },
];

// A decision here changes the trip, the order or the books it came from.
const EFFECTS = [KEYS.approvals, KEYS.dashboard, KEYS.logistics, KEYS.orders, KEYS.procurement, KEYS.finance, KEYS.spot, KEYS.inventory];

/** "10 mins ago", "3 hours ago", "1 day ago". */
function ago(iso: string, t: Translate): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('Just now');
  if (minutes < 60) return t(minutes === 1 ? '{n} min ago' : '{n} mins ago', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(hours === 1 ? '{n} hour ago' : '{n} hours ago', { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? '{n} day ago' : '{n} days ago', { n: days });
}

/** Where Review opens it. */
function reviewHref(item: InboxItem): string {
  switch (item.kind) {
    case 'ai':
      return '/ai';
    case 'dispute':
      return `/customers?open=${item.refs.customerId}`;
    case 'trip_close':
    case 'expense':
      return `/logistics?open=${item.refs.tripId}`;
    case 'purchase_order':
      return `/procurement?open=${item.refs.purchaseOrderId}`;
    case 'customer_order':
      return `/orders?open=${item.refs.orderId}`;
    case 'spot_price':
      return '/spot-sales';
    case 'driver_request':
      return '/approvals';
  }
}

interface Decision {
  note?: string;
  amount?: number;
  paidFrom?: 'bank' | 'cash_on_hand';
  paymentTermsDays?: number;
}

/** What Approve / Reject sends, for the kinds decided here. */
async function decide(item: InboxItem, approve: boolean, d: Decision): Promise<void> {
  const r = item.refs;
  const note = d.note;
  if (item.kind === 'driver_request') {
    // Approving does it: the advance paid, the customer created, the limit set.
    await apiSend('POST', `driver-requests/${r.driverRequestId}/decision`, approve ? { approve, ...d } : { approve, note });
    return;
  }
  if (item.kind === 'expense') {
    await apiSend('POST', `logistics/trips/${r.tripId}/expenses/${r.expenseId}/decision`, { approve, note });
    return;
  }
  if (item.kind === 'spot_price') {
    await apiSend('POST', `spot-sales/${r.spotSaleId}/decision`, { approved: approve, note });
    return;
  }
  // An order or purchase order: decide the request, then confirm it (or cancel it) at once.
  await apiSend('POST', `approval-requests/${r.approvalRequestId}/${approve ? 'approve' : 'reject'}`, { version: r.approvalVersion, note });
  const finalize = item.kind === 'purchase_order' ? `procurement/purchase-orders/${r.purchaseOrderId}/finalize-confirmation` : `orders/${r.orderId}/finalize-confirmation`;
  try {
    await apiSend('POST', finalize);
  } catch (err) {
    throw new Error(`${approve ? 'Approved' : 'Rejected'} — but it couldn't be finished here: ${(err as Error).message} Open it to finish.`);
  }
}

const DECIDED_HERE: InboxKind[] = ['expense', 'purchase_order', 'customer_order', 'spot_price', 'driver_request'];

/**
 * Approvals & Exceptions (client design, set 1 screen 17): one place for
 * everything waiting for the owner — an expense beyond a driver's
 * authority, an order or purchase order over its approval threshold, a spot
 * sale priced outside its band, a driver's request from the road — an
 * advance, a new customer, a higher credit limit (each approved or rejected
 * right here), AI
 * suggestions, disputes and trips to close (Review opens them).
 */
export default function ApprovalsPage() {
  const t = useT();
  const currency = useCurrency();
  const { data: session } = useSession();
  const inbox = useApprovalsInbox();
  const [tab, setTab] = useState<InboxTab | 'all'>('all');
  const [deciding, setDeciding] = useState<{ item: InboxItem; approve: boolean } | null>(null);
  const canDecide = (item: InboxItem) =>
    DECIDED_HERE.includes(item.kind) &&
    (item.kind !== 'expense' || hasPermission(session, 'logistics:reconcile')) &&
    (item.kind !== 'driver_request' || !item.refs.requestKind || hasPermission(session, REQUEST[item.refs.requestKind].permission));
  const items = (inbox.data?.items ?? []).filter((i) => tab === 'all' || i.tab === tab);

  return (
    <div className="list-screen" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('Approvals & Exceptions')}</h1>
      <DayTabs
        label="Which approvals"
        value={tab}
        onChange={setTab}
        options={TABS.map((o) => ({ ...o, count: inbox.data?.counts[o.value] }))}
      />
      {inbox.isPending ? (
        <SkeletonLines lines={6} height={64} />
      ) : inbox.error ? (
        <div className="panel">
          <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
        </div>
      ) : (
        <div className="card-list">
          {items.length === 0 && <div className="list-empty">{t('Nothing is waiting for you.')}</div>}
          {items.map((item) => {
            const kind = KIND[item.kind];
            const title = titleOf(item);
            return (
              <div key={item.key} className="inbox-row" data-kind={item.kind}>
                <span className="inbox-icon" aria-hidden="true">
                  <Icon name={kind.icon} size={20} />
                </span>
                <span className="inbox-main">
                  <span className="inbox-title">{t(title)}</span>
                  <span className="inbox-subject">
                    {item.subject}
                    {item.amount && Number(item.amount) !== 0 ? ` · ${formatMoney(item.amount, currency)}` : ''}
                  </span>
                  {item.detail && <span className="inbox-detail">{item.detail}</span>}
                  <span className="inbox-when">
                    {ago(item.at, t)}
                    {item.by ? ` · ${item.by}` : ''}
                  </span>
                </span>
                <span className="inbox-actions">
                  {canDecide(item) ? (
                    <>
                      <button type="button" className="button button-small button-danger" onClick={() => setDeciding({ item, approve: false })}>
                        {t('Reject')}
                      </button>
                      <button type="button" className="button button-small button-primary" onClick={() => setDeciding({ item, approve: true })}>
                        {t('Approve')}
                      </button>
                    </>
                  ) : (
                    <Link className="button button-small" href={reviewHref(item)}>
                      {t('Review')}
                    </Link>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {deciding && <DecideDialog item={deciding.item} approve={deciding.approve} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecideDialog({ item, approve, onClose }: { item: InboxItem; approve: boolean; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(item.amount ? String(Number(item.amount)) : '');
  const [paidFrom, setPaidFrom] = useState<'bank' | 'cash_on_hand'>('bank');
  const [terms, setTerms] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const request = useDriverRequest(item.kind === 'driver_request' ? (item.refs.driverRequestId ?? null) : null);
  const run = useAction((input: Decision) => decide(item, approve, input), EFFECTS, onClose);
  const requestKind = item.kind === 'driver_request' ? item.refs.requestKind : undefined;
  // A rejected expense is settled with the driver, and a refused request read by them: say why.
  const needsReason = !approve && (item.kind === 'expense' || item.kind === 'driver_request');
  const r = request.data;
  return (
    <FormDialog
      title={t(approve ? 'Approve this?' : 'Reject this?')}
      description={
        <p>
          <strong>{t(titleOf(item))}</strong> — {item.subject}
          {item.amount && requestKind !== 'credit_limit' ? ` · ${formatMoney(item.amount, currency)}` : ''}
          {item.kind === 'expense' && !approve && <> {t('It stays on the trip, to settle with the driver when you close it.')}</>}
          {(item.kind === 'purchase_order' || item.kind === 'customer_order') && <> {t(approve ? 'It is confirmed at once.' : 'It is cancelled.')}</>}
          {requestKind === 'advance' && approve && <> {t('It is recorded as an advance to the driver and recovered from their pay.')}</>}
          {requestKind === 'new_customer' && approve && <> {t('The customer is added, with the map pin the driver dropped.')}</>}
          {requestKind === 'credit_limit' && approve && <> {t("The customer's credit limit is changed at once.")}</>}
          {item.kind === 'driver_request' && !approve && <> {t('The driver sees your reason on their Approvals screen.')}</>}
        </p>
      }
      submitLabel={t(approve ? 'Approve' : 'Reject')}
      tone={approve ? undefined : 'danger'}
      pending={run.isPending}
      error={problem ?? run.error}
      onClose={onClose}
      onSubmit={() => {
        if (needsReason && note.trim().length < 3) return setProblem(t('Say why it is rejected.'));
        const decision: Decision = { note: note.trim() || undefined };
        if (approve && (requestKind === 'advance' || requestKind === 'credit_limit')) {
          const n = Number(amount);
          if (!amount.trim() || !Number.isFinite(n) || n < 0 || (requestKind === 'advance' && n <= 0)) return setProblem(t('Enter an amount.'));
          if (requestKind === 'advance' && item.amount && n > Number(item.amount)) return setProblem(t('Pay what was asked, or less.'));
          decision.amount = n;
          if (requestKind === 'advance') decision.paidFrom = paidFrom;
        }
        if (approve && requestKind && requestKind !== 'advance' && terms.trim()) decision.paymentTermsDays = Math.max(0, Math.min(180, Math.round(Number(terms))));
        setProblem(null);
        run.mutate(decision);
      }}
    >
      {r && r.kind === 'new_customer' && r.newCustomer && (
        <dl className="request-facts">
          <dt>{t('Name')}</dt>
          <dd>{r.newCustomer.name}</dd>
          <dt>{t('Phone')}</dt>
          <dd>{r.newCustomer.phone ?? '—'}</dd>
          <dt>{t('Place')}</dt>
          <dd>{[r.newCustomer.place, r.newCustomer.address].filter(Boolean).join(', ') || '—'}</dd>
          <dt>{t('Map pin')}</dt>
          <dd>
            {r.newCustomer.latitude !== null && r.newCustomer.longitude !== null ? (
              <a href={`https://www.google.com/maps?q=${r.newCustomer.latitude},${r.newCustomer.longitude}`} target="_blank" rel="noreferrer">
                {t('Open in Maps')}
              </a>
            ) : (
              t('None')
            )}
          </dd>
        </dl>
      )}
      {r && r.kind === 'credit_limit' && (
        <p className="request-facts">
          {t('{customer}: now {current}, asked {asked}', {
            customer: r.customerName ?? '',
            current: formatMoney(r.currentCreditLimit ?? '0', currency),
            asked: formatMoney(r.amount ?? '0', currency),
          })}
        </p>
      )}
      {item.kind === 'driver_request' && r && <p className="request-facts">{t('Why: {reason}', { reason: r.reason })}</p>}
      {approve && (requestKind === 'advance' || requestKind === 'credit_limit') && (
        <Field label={t(requestKind === 'advance' ? 'Amount to pay' : 'Credit limit')}>
          {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
      )}
      {approve && requestKind === 'advance' && (
        <Field label={t('Paid from')}>
          {(props) => (
            <select {...props} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as 'bank' | 'cash_on_hand')}>
              <option value="bank">{t('Bank (UPI transfer)')}</option>
              <option value="cash_on_hand">{t('Cash on hand')}</option>
            </select>
          )}
        </Field>
      )}
      {approve && (requestKind === 'new_customer' || requestKind === 'credit_limit') && (
        <Field label={t('Days to pay (optional)')}>
          {(props) => <input {...props} inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ''))} />}
        </Field>
      )}
      <Field label={t(needsReason ? 'Reason' : 'Note (optional)')} wide>
        {(props) => <textarea {...props} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
