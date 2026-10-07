'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InvoiceDispute, InvoiceRecord, Paginated } from '@morbeez/shared-types';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useActiveCustomers, useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs } from '@/components/ui/ListControls';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Field, FormDialog } from '@/components/ui/Form';

const REFRESH = [KEYS.finance, KEYS.alerts];

/**
 * Invoice disputes (client Q&A, finance). While one is open, finance
 * charges pause on the disputed amount only. Untouched for 30 days it
 * becomes a critical exception. Closing one records what was agreed — it
 * never writes off or reverses anything by itself.
 */
export function Disputes() {
  const { data: session } = useSession();
  const canRaise = hasPermission(session, 'finance:collect');
  const canClose = hasPermission(session, 'finance:manage');
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [status, setStatus] = useState<'open' | 'resolved' | 'withdrawn'>('open');
  const [raising, setRaising] = useState(false);
  const [noting, setNoting] = useState<InvoiceDispute | null>(null);
  const [closing, setClosing] = useState<InvoiceDispute | null>(null);
  const list = useQuery({
    queryKey: ['finance', 'disputes', status],
    queryFn: () => apiGet<InvoiceDispute[]>('finance/disputes', { status }),
  });

  return (
    <Panel
      title="Disputes"
      meta={
        <span className="panel-actions">
          <FilterTabs
            label="Which disputes"
            options={[
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'withdrawn', label: 'Withdrawn' },
            ]}
            value={status}
            onChange={(v) => v !== 'all' && setStatus(v)}
          />
          {canRaise && (
            <button type="button" className="button button-primary" onClick={() => setRaising(true)}>
              Record a dispute
            </button>
          )}
        </span>
      }
    >
      <p className="muted panel-note">
        While a dispute is open, no finance charge accrues on the disputed amount. After 30 days with nothing done, it
        alerts you.
      </p>
      {list.isPending ? (
        <SkeletonLines lines={4} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer · invoice</th>
                <th className="num">Disputed</th>
                <th>Why</th>
                <th>{status === 'open' ? 'Last activity' : 'Outcome'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    {status === 'open' ? 'No open disputes.' : 'None.'}
                  </td>
                </tr>
              )}
              {(list.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.customerName}
                    <div className="cell-sub">{d.invoiceNumber}</div>
                  </td>
                  <td className="num">{formatMoney(d.amount, currency)}</td>
                  <td>
                    {d.reason}
                    {d.notes.length > 0 && <div className="cell-sub">Latest: {d.notes[d.notes.length - 1].text}</div>}
                  </td>
                  <td>
                    {d.status === 'open' ? (
                      <>
                        {formatDateTime(d.lastActivityAt, timeZone)}
                        <div>
                          <StatusBadge
                            status="idle"
                            tone={d.idleDays >= 30 ? 'bad' : d.idleDays >= 20 ? 'attention' : 'muted'}
                            label={d.idleDays === 0 ? 'Today' : `${d.idleDays} day${d.idleDays === 1 ? '' : 's'} quiet`}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {d.resolution}
                        <div className="cell-sub">{formatDateTime(d.resolvedAt, timeZone)}</div>
                      </>
                    )}
                  </td>
                  <td className="num">
                    {d.status === 'open' && (
                      <span className="row-actions">
                        {canRaise && (
                          <button type="button" className="button button-ghost" onClick={() => setNoting(d)}>
                            Add a note
                          </button>
                        )}
                        {canClose && (
                          <button type="button" className="button" onClick={() => setClosing(d)}>
                            Close
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {raising && <RaiseDisputeDialog currency={currency} onClose={() => setRaising(false)} />}
      {noting && <NoteDialog dispute={noting} onClose={() => setNoting(null)} />}
      {closing && <CloseDialog dispute={closing} currency={currency} onClose={() => setClosing(null)} />}
    </Panel>
  );
}

function RaiseDisputeDialog({ currency, onClose }: { currency: string; onClose: () => void }) {
  const customers = useActiveCustomers();
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const invoices = useQuery({
    queryKey: ['finance', 'invoices', 'open', customerId],
    queryFn: () => apiGet<Paginated<InvoiceRecord>>('finance/invoices', { customerId, state: 'open', pageSize: 100 }),
    enabled: !!customerId,
  });
  const invoice = invoices.data?.items.find((i) => i.id === invoiceId);
  const raise = useAction((body: { invoiceId: string; amount: number; reason: string }) => apiSend('POST', 'finance/disputes', body), REFRESH, onClose);

  return (
    <FormDialog
      title="Record a dispute"
      description={<p>Part or all of one invoice. Finance charges pause on the disputed amount until it&apos;s closed.</p>}
      submitLabel="Record dispute"
      pending={raise.isPending}
      error={problem ?? raise.error}
      onClose={onClose}
      onSubmit={() => {
        const value = Number(amount.replace(/,/g, ''));
        if (!invoiceId) return setProblem('Choose the invoice.');
        if (!(value > 0)) return setProblem('Enter the amount disputed.');
        if (reason.trim().length < 3) return setProblem('Say what the customer disputes.');
        setProblem(null);
        raise.mutate({ invoiceId, amount: value, reason: reason.trim() });
      }}
    >
      <Field label="Customer">
        {(p) => (
          <select
            {...p}
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setInvoiceId('');
            }}
          >
            <option value="">Choose a customer…</option>
            {customers.records.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Invoice">
        {(p) => (
          <select {...p} value={invoiceId} disabled={!customerId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">{customerId && invoices.isPending ? 'Loading…' : 'Choose an open invoice…'}</option>
            {(invoices.data?.items ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} · {formatMoney(i.outstanding, currency)} owed
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Amount disputed (${currency})`} hint={invoice ? `Up to ${formatMoney(invoice.outstanding, currency)}` : undefined}>
        {(p) => <input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="What the customer disputes" wide>
        {(p) => <input {...p} value={reason} maxLength={1000} placeholder="12 kg short against the farm weight" onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function NoteDialog({ dispute, onClose }: { dispute: InvoiceDispute; onClose: () => void }) {
  const [note, setNote] = useState('');
  const add = useAction((text: string) => apiSend('POST', `finance/disputes/${dispute.id}/notes`, { note: text }), REFRESH, onClose);
  return (
    <FormDialog
      title={`Note on ${dispute.invoiceNumber}`}
      description={<p>What was said or done. Each note restarts the 30-day clock.</p>}
      submitLabel="Add note"
      pending={add.isPending}
      error={add.error}
      onClose={onClose}
      onSubmit={() => add.mutate(note.trim())}
    >
      <Field label="Note" wide>
        {(p) => <input {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function CloseDialog({ dispute, currency, onClose }: { dispute: InvoiceDispute; currency: string; onClose: () => void }) {
  const [outcome, setOutcome] = useState<'resolved' | 'withdrawn'>('resolved');
  const [resolution, setResolution] = useState('');
  const close = useAction(
    () => apiSend('POST', `finance/disputes/${dispute.id}/close`, { version: dispute.version, outcome, resolution: resolution.trim() }),
    REFRESH,
    onClose,
  );
  return (
    <FormDialog
      title={`Close the dispute on ${dispute.invoiceNumber}`}
      description={
        <p>
          {formatMoney(dispute.amount, currency)} disputed: {dispute.reason}. Closing writes nothing off and reverses
          nothing — if the customer is owed a credit, record it separately. Finance charges resume on this amount.
        </p>
      }
      submitLabel="Close dispute"
      pending={close.isPending}
      error={close.error}
      onClose={onClose}
      onSubmit={() => close.mutate(undefined)}
    >
      <Field label="Outcome">
        {(p) => (
          <select {...p} value={outcome} onChange={(e) => setOutcome(e.target.value as 'resolved' | 'withdrawn')}>
            <option value="resolved">Resolved — agreed with the customer</option>
            <option value="withdrawn">Withdrawn by the customer</option>
          </select>
        )}
      </Field>
      <Field label="What was agreed" wide>
        {(p) => <input {...p} value={resolution} maxLength={1000} onChange={(e) => setResolution(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
