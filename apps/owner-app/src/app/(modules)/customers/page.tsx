'use client';

import { useState } from 'react';
import type {
  CreateCustomerBody,
  CustomerReceivable,
  CustomerRecord,
  UpdateCreditTermsBody,
  UpdateCustomerBody,
} from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { AgingBar } from '@/components/finance/AgingBar';
import { CustomerPaymentDialog } from '@/components/forms/PaymentDialogs';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCustomer, useCustomerCredit, useCustomers, useReceivables } from '@/lib/hooks/use-modules';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDateTime, formatMoney } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';
import {
  firstError,
  optionalText,
  parseDecimal,
  parseMoney,
  parseWholeNumber,
  type Parsed,
} from '@/lib/parse';

const CUSTOMER_EFFECTS = [KEYS.customers, KEYS.lookupCustomers, KEYS.finance, KEYS.dashboard];

/**
 * Credit in use, as the backend's credit check defines exposure: what the
 * customer owes (net of money held on account) plus confirmed orders not
 * yet delivered. A display-only ratio.
 */
function creditUse(receivable: CustomerReceivable | undefined, creditLimit: string): number | null {
  if (!receivable || Number(creditLimit) <= 0) return null;
  const exposure =
    Number(receivable.outstanding) - Number(receivable.creditOnAccount) + Number(receivable.openOrderValue);
  return (Math.max(exposure, 0) / Number(creditLimit)) * 100;
}

function CreditMeter({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="muted">—</span>;
  const tone = percent > 100 ? 'bad' : percent >= 80 ? 'attention' : undefined;
  return (
    <span className="meter-cell">
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${Math.min(percent, 100)}%` }} data-tone={tone} />
      </span>
      <span data-tone={tone} className="meter-label">
        {Math.round(percent)}%
      </span>
    </span>
  );
}

function termsLabel(days: number) {
  return days === 0 ? 'On delivery' : `${days} days`;
}

// ---- Forms ----

function ContactFields({
  phone,
  email,
  notes,
  onChange,
}: {
  phone: string;
  email: string;
  notes: string;
  onChange: (patch: { phone?: string; email?: string; notes?: string }) => void;
}) {
  return (
    <>
      <Field label="Phone (optional)">
        {(props) => (
          <input {...props} type="tel" maxLength={20} value={phone} onChange={(e) => onChange({ phone: e.target.value })} />
        )}
      </Field>
      <Field label="Email (optional)">
        {(props) => <input {...props} type="email" value={email} onChange={(e) => onChange({ email: e.target.value })} />}
      </Field>
      <Field label="Notes (optional)" wide>
        {(props) => (
          <textarea {...props} maxLength={500} value={notes} onChange={(e) => onChange({ notes: e.target.value })} />
        )}
      </Field>
    </>
  );
}

function checkEmail(email: string): Parsed<string | undefined> {
  const value = optionalText(email);
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: 'That email address looks incomplete.' };
  return { ok: true, value };
}

function checkName(name: string): Parsed<string> {
  const value = name.trim();
  return value.length >= 2 ? { ok: true, value } : { ok: false, error: 'Enter the customer’s name (at least 2 characters).' };
}

function NewCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CustomerRecord) => void }) {
  const currency = useCurrency();
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', creditLimit: '0', terms: '0' });
  const [problem, setProblem] = useState<string | null>(null);
  const create = useAction(
    (body: CreateCustomerBody) => apiSend<CustomerRecord>('POST', 'customers', body),
    CUSTOMER_EFFECTS,
    onCreated,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = () => {
    const name = checkName(form.name);
    const email = checkEmail(form.email);
    const limit = parseMoney(form.creditLimit, 'the credit limit');
    const terms = parseWholeNumber(form.terms, 'payment terms', 0, 180);
    const error = firstError([name, email, limit, terms]);
    if (error) return setProblem(error);
    setProblem(null);
    create.mutate({
      name: (name as { value: string }).value,
      contact: {
        phone: optionalText(form.phone),
        email: (email as { value: string | undefined }).value,
        notes: optionalText(form.notes),
      },
      creditLimit: (limit as { value: number }).value,
      paymentTermsDays: (terms as { value: number }).value,
    });
  };

  return (
    <FormDialog
      title="New customer"
      submitLabel="Add customer"
      pending={create.isPending}
      error={problem ?? create.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Name" wide>
        {(props) => <input {...props} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <ContactFields phone={form.phone} email={form.email} notes={form.notes} onChange={set} />
      <Field label={`Credit limit (${currency})`} hint="0 means cash only — no confirmed orders on credit">
        {(props) => (
          <input {...props} inputMode="decimal" value={form.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} />
        )}
      </Field>
      <Field label="Payment terms (days)" hint="0 = pays on delivery; up to 180">
        {(props) => <input {...props} inputMode="numeric" value={form.terms} onChange={(e) => set({ terms: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}

function EditCustomerDialog({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }) {
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.contact.phone ?? '',
    email: customer.contact.email ?? '',
    notes: customer.contact.notes ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const update = useAction(
    (body: UpdateCustomerBody) => apiSend<CustomerRecord>('PATCH', `customers/${customer.id}`, body),
    CUSTOMER_EFFECTS,
    onClose,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = () => {
    const name = checkName(form.name);
    const email = checkEmail(form.email);
    const error = firstError([name, email]);
    if (error) return setProblem(error);
    setProblem(null);
    update.mutate({
      version: customer.version,
      name: (name as { value: string }).value,
      contact: {
        phone: optionalText(form.phone),
        email: (email as { value: string | undefined }).value,
        notes: optionalText(form.notes),
      },
    });
  };

  return (
    <FormDialog
      title={`Edit ${customer.name}`}
      submitLabel="Save"
      pending={update.isPending}
      error={problem ?? update.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Name" wide>
        {(props) => <input {...props} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <ContactFields phone={form.phone} email={form.email} notes={form.notes} onChange={set} />
    </FormDialog>
  );
}

function CreditTermsDialog({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }) {
  const currency = useCurrency();
  const [form, setForm] = useState({
    limit: customer.creditLimit,
    terms: String(customer.paymentTermsDays),
    rate: customer.financeChargeRateMonthly,
    grace: String(customer.financeChargeGraceDays),
    hold: customer.creditHold,
    reason: customer.creditHoldReason ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: UpdateCreditTermsBody) => apiSend<CustomerRecord>('POST', `customers/${customer.id}/credit-terms`, body),
    CUSTOMER_EFFECTS,
    onClose,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = () => {
    const limit = parseMoney(form.limit, 'the credit limit');
    const terms = parseWholeNumber(form.terms, 'payment terms', 0, 180);
    const rate = parseDecimal(form.rate, 'the finance charge rate', { decimals: 2, max: 5 });
    const grace = parseWholeNumber(form.grace, 'the grace period', 0, 90);
    const reason: Parsed<string | undefined> =
      form.hold && form.reason.trim().length < 3
        ? { ok: false, error: 'Say why the customer is on hold (at least 3 characters).' }
        : { ok: true, value: form.hold ? form.reason.trim() : undefined };
    const error = firstError([limit, terms, rate, grace, reason]);
    if (error) return setProblem(error);
    setProblem(null);
    save.mutate({
      version: customer.version,
      creditLimit: (limit as { value: number }).value,
      paymentTermsDays: (terms as { value: number }).value,
      financeChargeRateMonthly: (rate as { value: number }).value,
      financeChargeGraceDays: (grace as { value: number }).value,
      creditHold: form.hold,
      creditHoldReason: (reason as { value: string | undefined }).value,
    });
  };

  return (
    <FormDialog
      title={`Credit terms — ${customer.name}`}
      description={
        <p>New terms apply going forward: invoices already issued keep the due date they were issued with.</p>
      }
      submitLabel="Save terms"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={`Credit limit (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={form.limit} onChange={(e) => set({ limit: e.target.value })} />}
      </Field>
      <Field label="Payment terms (days)" hint="0 = pays on delivery">
        {(props) => <input {...props} inputMode="numeric" value={form.terms} onChange={(e) => set({ terms: e.target.value })} />}
      </Field>
      <Field label="Finance charge (% per month)" hint="On overdue invoices; 0 for none, up to 5">
        {(props) => <input {...props} inputMode="decimal" value={form.rate} onChange={(e) => set({ rate: e.target.value })} />}
      </Field>
      <Field label="Grace before charging (days)" hint="Days past due before the charge starts">
        {(props) => <input {...props} inputMode="numeric" value={form.grace} onChange={(e) => set({ grace: e.target.value })} />}
      </Field>
      <div className="field field-check form-wide">
        <input
          id="credit-hold"
          type="checkbox"
          checked={form.hold}
          onChange={(e) => set({ hold: e.target.checked })}
        />
        <label htmlFor="credit-hold">On credit hold — no new orders confirm until lifted</label>
      </div>
      {form.hold && (
        <Field label="Reason for the hold" wide>
          {(props) => <input {...props} maxLength={500} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />}
        </Field>
      )}
    </FormDialog>
  );
}

// ---- Detail ----

function CustomerDetail({
  customer,
  receivable,
  onClose,
}: {
  customer: CustomerRecord;
  receivable: CustomerReceivable | undefined;
  onClose: () => void;
}) {
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const { data: session } = useSession();
  const canSeeFinance = hasPermission(session, 'finance:read');
  const canWrite = hasPermission(session, 'customers:write');
  const canSetCredit = hasPermission(session, 'customers:credit');
  const canCollect = hasPermission(session, 'finance:collect');
  const credit = useCustomerCredit(customer.id, canSeeFinance);
  const [open, setOpen] = useState<'edit' | 'credit' | 'archive' | 'payment' | null>(null);
  const close = () => setOpen(null);
  const archived = customer.status === 'archived';
  const toggle = useAction(
    () => apiSend<CustomerRecord>('POST', `customers/${customer.id}/${archived ? 'restore' : 'archive'}`),
    CUSTOMER_EFFECTS,
    close,
  );

  return (
    <DetailPanel title={customer.name} onClose={onClose}>
      <KeyValues
        items={[
          ['Status', <StatusBadge key="s" status={customer.status} />],
          ['Payment terms', termsLabel(customer.paymentTermsDays)],
          ['Credit limit', formatMoney(customer.creditLimit, currency)],
          [
            'Finance charge',
            Number(customer.financeChargeRateMonthly) > 0
              ? `${customer.financeChargeRateMonthly}% a month after ${customer.financeChargeGraceDays} days' grace`
              : 'None',
          ],
          ['Phone', customer.contact.phone ?? '—'],
          ['Email', customer.contact.email ?? '—'],
        ]}
      />
      {customer.creditHold && (
        <p className="action-note" data-tone="bad">
          <strong>On credit hold</strong>
          {customer.creditHoldReason ? ` — ${customer.creditHoldReason}` : ''}. Orders for this customer won&apos;t
          confirm until the hold is lifted.
        </p>
      )}
      {customer.contact.notes && <p className="muted">{customer.contact.notes}</p>}
      <ActionBar>
        {canCollect && !archived && (
          <button type="button" className="button button-primary" onClick={() => setOpen('payment')}>
            Record payment
          </button>
        )}
        {canWrite && !archived && (
          <button type="button" className="button" onClick={() => setOpen('edit')}>
            Edit details
          </button>
        )}
        {canSetCredit && !archived && (
          <button type="button" className="button" onClick={() => setOpen('credit')}>
            Credit terms
          </button>
        )}
        {canWrite && (
          <button type="button" className={archived ? 'button' : 'button button-danger'} onClick={() => setOpen('archive')}>
            {archived ? 'Restore' : 'Archive'}
          </button>
        )}
      </ActionBar>

      {canSeeFinance && (
        <>
          <h3 className="detail-subhead">Money</h3>
          {receivable ? (
            <>
              <KeyValues
                items={[
                  ['Invoiced to date', formatMoney(receivable.invoiced, currency)],
                  ['Collected to date', formatMoney(receivable.collected, currency)],
                  ['Outstanding', formatMoney(receivable.outstanding, currency)],
                  ...(Number(receivable.creditOnAccount) > 0
                    ? ([['Held on account', formatMoney(receivable.creditOnAccount, currency)]] as [string, string][])
                    : []),
                  ['Confirmed, not delivered', formatMoney(receivable.openOrderValue, currency)],
                  [
                    'Credit available',
                    credit.data ? (
                      <span key="a" data-tone={Number(credit.data.available) < 0 ? 'bad' : undefined}>
                        {formatMoney(credit.data.available, currency)}
                      </span>
                    ) : (
                      '…'
                    ),
                  ],
                  ['Last payment', formatDateTime(receivable.lastCollectionAt, timeZone)],
                ]}
              />
              <h3 className="detail-subhead">What&apos;s owed, by age</h3>
              <AgingBar receivable={receivable} currency={currency} />
            </>
          ) : (
            <p className="muted">No invoices or open orders yet.</p>
          )}
        </>
      )}

      {open === 'edit' && <EditCustomerDialog customer={customer} onClose={close} />}
      {open === 'credit' && <CreditTermsDialog customer={customer} onClose={close} />}
      {open === 'payment' && (
        <CustomerPaymentDialog customerId={customer.id} customerName={customer.name} currency={currency} onClose={close} />
      )}
      {open === 'archive' && (
        <FormDialog
          title={archived ? `Restore ${customer.name}?` : `Archive ${customer.name}?`}
          description={
            <p>
              {archived
                ? 'They can be chosen for new orders again.'
                : 'They stop appearing when placing new orders. Their history and anything they owe stay as they are.'}
            </p>
          }
          submitLabel={archived ? 'Restore' : 'Archive'}
          tone={archived ? undefined : 'danger'}
          pending={toggle.isPending}
          error={toggle.error}
          onClose={close}
          onSubmit={() => toggle.mutate(undefined)}
        />
      )}
    </DetailPanel>
  );
}

export default function CustomersPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: session } = useSession();
  const canSeeFinance = hasPermission(session, 'finance:read');
  const canWrite = hasPermission(session, 'customers:write');
  const { data, error, isPending, isPlaceholderData, refetch } = useCustomers(page);
  const receivables = useReceivables(canSeeFinance);
  const currency = useCurrency();

  const byCustomer = new Map((receivables.data?.customers ?? []).map((r) => [r.customerId, r]));
  const onPage = data?.items.find((c) => c.id === selected);
  // A customer just added may sort onto another page; fetch it directly.
  const single = useCustomer(selected && data && !onPage ? selected : null);
  const selectedCustomer = onPage ?? single.data ?? null;
  const columns = canSeeFinance ? 6 : 3;

  return (
    <div className="stack">
      <PageHeader
        title="Customers"
        subtitle="Who you sell to — their terms, what they owe, and how much credit they're using."
        actions={
          canWrite && (
            <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
              New customer
            </button>
          )
        }
      />
      {creating && (
        <NewCustomerDialog
          onClose={() => setCreating(false)}
          onCreated={(customer) => {
            setCreating(false);
            setPage(1);
            setSelected(customer.id);
          }}
        />
      )}
      <div className="split" data-detail={selectedCustomer ? 'open' : undefined}>
        <Panel title="Customers" meta={data ? `${data.total} total` : undefined}>
          {isPending ? (
            <SkeletonLines lines={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <div data-updating={isPlaceholderData || undefined} className="updating">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Terms</th>
                      <th className="align-right">Credit limit</th>
                      {canSeeFinance && (
                        <>
                          <th className="align-right">Outstanding</th>
                          <th className="align-right">Overdue</th>
                          <th className="align-right">Credit in use</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <EmptyRow colSpan={columns}>No customers yet.</EmptyRow>}
                    {data.items.map((customer) => {
                      const receivable = byCustomer.get(customer.id);
                      const overdue = receivable
                        ? sumMoney([receivable.overdue1To30, receivable.overdue31To60, receivable.overdueOver60])
                        : '0.00';
                      return (
                        <SelectableRow
                          key={customer.id}
                          selected={selected === customer.id}
                          onSelect={() => setSelected(customer.id)}
                          label={customer.name}
                        >
                          <td>
                            {customer.name}
                            {customer.status === 'archived' && (
                              <>
                                {' '}
                                <StatusBadge status="archived" />
                              </>
                            )}
                            {customer.creditHold && (
                              <>
                                {' '}
                                <StatusBadge status="credit_hold" tone="bad" label="On hold" />
                              </>
                            )}
                          </td>
                          <td>{termsLabel(customer.paymentTermsDays)}</td>
                          <td className="align-right">{formatMoney(customer.creditLimit, currency)}</td>
                          {canSeeFinance && (
                            <>
                              <td className="align-right">
                                {receivables.isPending ? '…' : formatMoney(receivable?.outstanding ?? '0', currency)}
                              </td>
                              <td className="align-right" data-tone={Number(overdue) > 0 ? 'bad' : undefined}>
                                {receivables.isPending ? '…' : Number(overdue) > 0 ? formatMoney(overdue, currency) : '—'}
                              </td>
                              <td className="align-right">
                                <CreditMeter percent={creditUse(receivable, customer.creditLimit)} />
                              </td>
                            </>
                          )}
                        </SelectableRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              {receivables.error && (
                <p className="footnote">Couldn&apos;t load balances: {(receivables.error as Error).message}</p>
              )}
            </div>
          )}
        </Panel>
        {selectedCustomer && (
          <CustomerDetail
            key={selectedCustomer.id}
            customer={selectedCustomer}
            receivable={byCustomer.get(selectedCustomer.id)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
