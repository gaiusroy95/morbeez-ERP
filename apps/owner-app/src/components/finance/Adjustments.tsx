'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CreditNoteRecord, InvoiceRecord, Paginated, ReceivableWriteOffRecord } from '@morbeez/shared-types';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useActiveCustomers, useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDateTime, formatRate } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { EmptyRow } from '@/components/ui/ListControls';
import { Field, FormDialog } from '@/components/ui/Form';

const REFRESH = [KEYS.finance, KEYS.customers, KEYS.dashboard, KEYS.tax];

/**
 * Credit notes and bad-debt write-offs (Master Spec v3 P6; Accounting Engine
 * CN.1–CN.4, BD.1–BD.4). Neither edits an invoice: each is its own document
 * with its own journal, and what's outstanding comes down by it.
 */
export function Adjustments() {
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'finance:manage');
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [issuing, setIssuing] = useState(false);
  const [writing, setWriting] = useState(false);
  const notes = useQuery({ queryKey: ['finance', 'credit-notes'], queryFn: () => apiGet<CreditNoteRecord[]>('finance/credit-notes') });
  const writeOffs = useQuery({ queryKey: ['finance', 'write-offs'], queryFn: () => apiGet<ReceivableWriteOffRecord[]>('finance/write-offs') });

  return (
    <>
      <Panel
        title="Credit notes"
        meta={
          canManage ? (
            <button type="button" className="button button-primary" onClick={() => setIssuing(true)}>
              Issue a credit note
            </button>
          ) : undefined
        }
      >
        <p className="muted panel-note">
          A credit note lowers what a customer owes on one invoice — GST included — and books it to sales returns. It
          needs someone other than whoever issued the invoice. Accepting a dispute issues one by itself.
        </p>
        {notes.isPending ? (
          <SkeletonLines lines={3} />
        ) : notes.error ? (
          <ErrorState error={notes.error} onRetry={() => notes.refetch()} />
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Credit notes">
              <thead>
                <tr>
                  <th>Note · invoice</th>
                  <th>Customer</th>
                  <th>Why</th>
                  <th className="num">GST</th>
                  <th className="num">Amount</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {(notes.data ?? []).length === 0 && <EmptyRow colSpan={6}>No credit notes yet.</EmptyRow>}
                {(notes.data ?? []).map((n) => (
                  <tr key={n.id}>
                    <td>
                      <strong>{n.creditNoteNumber}</strong>
                      <div className="cell-sub">against {n.invoiceNumber}</div>
                    </td>
                    <td>{n.customerName}</td>
                    <td>
                      {n.reason}
                      {n.disputeId && <div className="cell-sub">From a dispute</div>}
                    </td>
                    <td className="num">{formatRate(sumMoney([n.cgst, n.sgst, n.igst, n.cess]), currency)}</td>
                    <td className="num strong">{formatRate(n.amount, currency)}</td>
                    <td>
                      {formatDateTime(n.issuedAt, timeZone)}
                      {n.issuedByLogin && <div className="cell-sub">{n.issuedByLogin}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Bad debts written off"
        meta={
          canManage ? (
            <button type="button" className="button" onClick={() => setWriting(true)}>
              Write off an invoice
            </button>
          ) : undefined
        }
      >
        <p className="muted panel-note">
          Nothing is ever written off automatically. Writing one off books it as a bad debt and puts the customer on
          credit hold until you review their terms.
        </p>
        {writeOffs.isPending ? (
          <SkeletonLines lines={2} />
        ) : writeOffs.error ? (
          <ErrorState error={writeOffs.error} onRetry={() => writeOffs.refetch()} />
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Bad debts written off">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Why</th>
                  <th className="num">Written off</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {(writeOffs.data ?? []).length === 0 && <EmptyRow colSpan={5}>Nothing written off.</EmptyRow>}
                {(writeOffs.data ?? []).map((w) => (
                  <tr key={w.id}>
                    <td>{w.invoiceNumber}</td>
                    <td>{w.customerName}</td>
                    <td>{w.reason}</td>
                    <td className="num strong">{formatRate(w.amount, currency)}</td>
                    <td>
                      {formatDateTime(w.writtenOffAt, timeZone)}
                      {w.writtenOffByLogin && <div className="cell-sub">{w.writtenOffByLogin}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {issuing && <CreditNoteDialog currency={currency} userId={session?.userId ?? ''} onClose={() => setIssuing(false)} />}
      {writing && <WriteOffDialog currency={currency} onClose={() => setWriting(false)} />}
    </>
  );
}

/** A customer, then one of their invoices with something outstanding. */
function InvoicePicker({
  currency,
  customerId,
  invoiceId,
  onCustomer,
  onInvoice,
}: {
  currency: string;
  customerId: string;
  invoiceId: string;
  onCustomer: (id: string) => void;
  onInvoice: (invoice: InvoiceRecord | null) => void;
}) {
  const customers = useActiveCustomers();
  const invoices = useQuery({
    queryKey: ['finance', 'invoices', 'outstanding', customerId],
    queryFn: () => apiGet<Paginated<InvoiceRecord>>('finance/invoices', { customerId, state: 'all', pageSize: 100 }),
    enabled: !!customerId,
  });
  const open = (invoices.data?.items ?? []).filter((i) => Number(i.outstanding) > 0);
  return (
    <>
      <Field label="Customer">
        {(p) => (
          <select
            {...p}
            value={customerId}
            onChange={(e) => {
              onCustomer(e.target.value);
              onInvoice(null);
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
          <select {...p} value={invoiceId} disabled={!customerId} onChange={(e) => onInvoice(open.find((i) => i.id === e.target.value) ?? null)}>
            <option value="">{customerId && invoices.isPending ? 'Loading…' : 'Choose an invoice with money owed…'}</option>
            {open.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} · {formatRate(i.outstanding, currency)} owed
              </option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

function CreditNoteDialog({ currency, userId, onClose }: { currency: string; userId: string; onClose: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const issue = useAction((body: { invoiceId: string; amount: number; reason: string }) => apiSend('POST', 'finance/credit-notes', body), REFRESH, onClose);
  const ownInvoice = !!invoice && invoice.createdBy === userId;

  return (
    <FormDialog
      title="Issue a credit note"
      description={<p>What the customer owes less on one invoice, GST included. The invoice itself never changes.</p>}
      submitLabel="Issue credit note"
      pending={issue.isPending}
      error={problem ?? issue.error}
      submitDisabled={ownInvoice}
      onClose={onClose}
      onSubmit={() => {
        const value = Number(amount.replace(/,/g, ''));
        if (!invoice) return setProblem('Choose the invoice.');
        if (!(value > 0)) return setProblem('Enter the amount to credit.');
        if (value > Number(invoice.outstanding)) return setProblem(`Only ${formatRate(invoice.outstanding, currency)} is owed on ${invoice.invoiceNumber}.`);
        if (reason.trim().length < 3) return setProblem('Say why the customer is credited.');
        setProblem(null);
        issue.mutate({ invoiceId: invoice.id, amount: value, reason: reason.trim() });
      }}
    >
      <InvoicePicker currency={currency} customerId={customerId} invoiceId={invoice?.id ?? ''} onCustomer={setCustomerId} onInvoice={setInvoice} />
      <Field
        label={`Amount to credit (${currency})`}
        hint={
          ownInvoice
            ? 'You issued this invoice — someone else has to approve its credit note.'
            : invoice
              ? `Up to ${formatRate(invoice.outstanding, currency)}`
              : undefined
        }
      >
        {(p) => <input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Why" wide>
        {(p) => <input {...p} value={reason} maxLength={1000} placeholder="6 kg of tomato soft on arrival" onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function WriteOffDialog({ currency, onClose }: { currency: string; onClose: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const writeOff = useAction((body: { invoiceId: string; reason: string }) => apiSend('POST', `finance/invoices/${body.invoiceId}/write-off`, { reason: body.reason }), REFRESH, onClose);

  return (
    <FormDialog
      title="Write off an invoice"
      tone="danger"
      description={
        <p>
          Books what&apos;s still owed on it as a bad debt and puts the customer on credit hold until their terms are
          reviewed. If they pay later, record the payment as usual — it stays on their account.
        </p>
      }
      submitLabel={invoice ? `Write off ${formatRate(invoice.outstanding, currency)}` : 'Write off'}
      pending={writeOff.isPending}
      error={problem ?? writeOff.error}
      onClose={onClose}
      onSubmit={() => {
        if (!invoice) return setProblem('Choose the invoice.');
        if (reason.trim().length < 3) return setProblem('Say why it can’t be collected.');
        setProblem(null);
        writeOff.mutate({ invoiceId: invoice.id, reason: reason.trim() });
      }}
    >
      <InvoicePicker currency={currency} customerId={customerId} invoiceId={invoice?.id ?? ''} onCustomer={setCustomerId} onInvoice={setInvoice} />
      <Field label="Why it can't be collected" wide>
        {(p) => <input {...p} value={reason} maxLength={1000} placeholder="Shop closed; owner unreachable for 120 days" onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
