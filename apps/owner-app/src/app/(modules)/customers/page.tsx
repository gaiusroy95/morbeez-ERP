'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type {
  CreateCustomerBody,
  CustomerCard,
  CustomerProfile,
  CustomerRecord,
  CustomersFilter,
  UpdateCreditTermsBody,
  UpdateCustomerBody,
} from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FilterTabs } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { AgingBar } from '@/components/finance/AgingBar';
import { CustomerPaymentDialog } from '@/components/forms/PaymentDialogs';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCustomerCredit, useReceivables } from '@/lib/hooks/use-modules';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import {
  firstError,
  optionalText,
  parseDecimal,
  parseMoney,
  parseWholeNumber,
  type Parsed,
} from '@/lib/parse';
import { LANGS, useT, type Lang, type Translate } from '@/lib/i18n';
import { useOpenOnNew } from '@/lib/hooks/use-open-on-new';
import { SearchSelect } from '@/components/forms/SearchSelect';
import { QuickAddRoute } from '@/components/forms/QuickAdd';
import { formatOrderNumber, useRoutes } from '@/lib/hooks/use-delivery-orders';
import { useCustomerProfile, useCustomersBoard, useCustomerStatement } from '@/lib/hooks/use-parties';
import { CreateBar, DayTabs, SearchFilter, type CardTone } from '@/components/redesign/ListCards';
import { ContactActions, PartyCard, ProfileHead, StatTiles } from '@/components/redesign/Party';
import { DeliveryQrDialog } from '@/components/customers/DeliveryQr';

// A customer's details and terms show in orders, finance and the dashboard too.
const CUSTOMER_EFFECTS = [KEYS.customers, KEYS.lookupCustomers, KEYS.finance, KEYS.dashboard];

function termsLabel(days: number, t: Translate) {
  return days === 0 ? t('On delivery') : t('{n} days', { n: days });
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
  const t = useT();
  return (
    <>
      <Field label={t('Phone (optional)')}>
        {(props) => (
          <input {...props} type="tel" maxLength={20} value={phone} onChange={(e) => onChange({ phone: e.target.value })} />
        )}
      </Field>
      <Field label={t('Email (optional)')}>
        {(props) => <input {...props} type="email" value={email} onChange={(e) => onChange({ email: e.target.value })} />}
      </Field>
      <Field label={t('Notes (optional)')} wide>
        {(props) => (
          <textarea {...props} maxLength={500} value={notes} onChange={(e) => onChange({ notes: e.target.value })} />
        )}
      </Field>
    </>
  );
}

/** Where the customer is: the place shown under their name, the address orders go to, their usual route. */
function PlaceFields({
  place,
  address,
  routeId,
  onChange,
  onAddRoute,
}: {
  place: string;
  address: string;
  routeId: string;
  onChange: (patch: { place?: string; address?: string; routeId?: string }) => void;
  onAddRoute: (typed: string) => void;
}) {
  const t = useT();
  const routes = useRoutes();
  const active = (routes.data ?? []).filter((r) => r.status === 'active' || r.id === routeId);
  return (
    <>
      <Field label={t('Village / town (optional)')}>
        {(props) => <input {...props} maxLength={120} value={place} onChange={(e) => onChange({ place: e.target.value })} />}
      </Field>
      <Field label={t('Usual route (optional)')}>
        {(props) => (
          <SearchSelect
            {...props}
            value={routeId}
            onChange={(id) => onChange({ routeId: id })}
            loading={routes.isPending}
            placeholder={t('Choose a route…')}
            searchPlaceholder={t('Search routes…')}
            options={[{ value: '', label: t('No route') }, ...active.map((r) => ({ value: r.id, label: r.name }))]}
            createLabel={t('Create new route')}
            onCreate={onAddRoute}
          />
        )}
      </Field>
      <Field label={t('Delivery address (optional)')} hint={t('Orders are delivered here unless the order says otherwise')} wide>
        {(props) => <input {...props} maxLength={300} value={address} onChange={(e) => onChange({ address: e.target.value })} />}
      </Field>
    </>
  );
}

/** Their statements and WhatsApp messages go out in this language; tax invoices stay in English. */
function LanguageField({ value, onChange }: { value: Lang; onChange: (language: Lang) => void }) {
  const t = useT();
  return (
    <Field label={t('Language for statements and messages')} hint={t('Tax invoices are always in English')}>
      {(props) => (
        <select {...props} value={value} onChange={(e) => onChange(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code === 'en' ? l.name : `${l.name} (${l.english})`}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function languageName(code: string): string {
  const found = LANGS.find((l) => l.code === code);
  return found ? (found.code === 'en' ? found.name : `${found.name} (${found.english})`) : code;
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
  const t = useT();
  const currency = useCurrency();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    notes: '',
    creditLimit: '0',
    terms: '0',
    language: 'en' as Lang,
    place: '',
    address: '',
    routeId: '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [addingRoute, setAddingRoute] = useState<string | null>(null);
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
      preferredLanguage: form.language,
      place: optionalText(form.place) ?? null,
      address: optionalText(form.address) ?? null,
      routeId: form.routeId || null,
    });
  };

  return (
    <>
      <FormDialog
      title={t('New customer')}
      submitLabel={t('Add customer')}
      pending={create.isPending}
      error={problem ?? create.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={t('Name')} wide>
        {(props) => <input {...props} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <ContactFields phone={form.phone} email={form.email} notes={form.notes} onChange={set} />
      <PlaceFields place={form.place} address={form.address} routeId={form.routeId} onChange={set} onAddRoute={setAddingRoute} />
      <Field label={`Credit limit (${currency})`} hint={t('0 means cash only — no confirmed orders on credit')}>
        {(props) => (
          <input {...props} inputMode="decimal" value={form.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} />
        )}
      </Field>
      <Field label={t('Payment terms (days)')} hint={t('0 = pays on delivery; up to 180')}>
        {(props) => <input {...props} inputMode="numeric" value={form.terms} onChange={(e) => set({ terms: e.target.value })} />}
      </Field>
      <LanguageField value={form.language} onChange={(language) => set({ language })} />
      </FormDialog>
      {addingRoute !== null && (
        <QuickAddRoute
          initialName={addingRoute}
          onClose={() => setAddingRoute(null)}
          onAdded={(route) => {
            set({ routeId: route.id });
            setAddingRoute(null);
          }}
        />
      )}
    </>
  );
}

function EditCustomerDialog({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.contact.phone ?? '',
    email: customer.contact.email ?? '',
    notes: customer.contact.notes ?? '',
    language: (customer.preferredLanguage ?? 'en') as Lang,
    place: customer.place ?? '',
    address: customer.address ?? '',
    routeId: customer.routeId ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [addingRoute, setAddingRoute] = useState<string | null>(null);
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
      preferredLanguage: form.language,
      place: optionalText(form.place) ?? null,
      address: optionalText(form.address) ?? null,
      routeId: form.routeId || null,
    });
  };

  return (
    <>
      <FormDialog
      title={t('Edit {name}', { name: customer.name })}
      submitLabel={t('Save')}
      pending={update.isPending}
      error={problem ?? update.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={t('Name')} wide>
        {(props) => <input {...props} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <ContactFields phone={form.phone} email={form.email} notes={form.notes} onChange={set} />
      <PlaceFields place={form.place} address={form.address} routeId={form.routeId} onChange={set} onAddRoute={setAddingRoute} />
      <LanguageField value={form.language} onChange={(language) => set({ language })} />
      </FormDialog>
      {addingRoute !== null && (
        <QuickAddRoute
          initialName={addingRoute}
          onClose={() => setAddingRoute(null)}
          onAdded={(route) => {
            set({ routeId: route.id });
            setAddingRoute(null);
          }}
        />
      )}
    </>
  );
}

function CreditTermsDialog({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const [form, setForm] = useState({
    limit: customer.creditLimit,
    terms: String(customer.paymentTermsDays),
    rate: customer.financeChargeRateAnnual,
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
    const rate = parseDecimal(form.rate, 'the finance charge rate', { decimals: 2, max: 60 });
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
      financeChargeRateAnnual: (rate as { value: number }).value,
      financeChargeGraceDays: (grace as { value: number }).value,
      creditHold: form.hold,
      creditHoldReason: (reason as { value: string | undefined }).value,
    });
  };

  return (
    <FormDialog
      title={`Credit terms — ${customer.name}`}
      description={
        <p>{t('New terms apply going forward: invoices already issued keep the due date they were issued with.')}</p>
      }
      submitLabel={t('Save terms')}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={`Credit limit (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={form.limit} onChange={(e) => set({ limit: e.target.value })} />}
      </Field>
      <Field label={t('Payment terms (days)')} hint={t('0 = pays on delivery')}>
        {(props) => <input {...props} inputMode="numeric" value={form.terms} onChange={(e) => set({ terms: e.target.value })} />}
      </Field>
      <Field label={t('Finance charge (% a year)')} hint={t("On what's overdue, per day: amount × rate × days ÷ 365. 0 for none, up to 60")}>
        {(props) => <input {...props} inputMode="decimal" value={form.rate} onChange={(e) => set({ rate: e.target.value })} />}
      </Field>
      <Field label={t('Grace before charging (days)')} hint={t('Days past due before the charge starts')}>
        {(props) => <input {...props} inputMode="numeric" value={form.grace} onChange={(e) => set({ grace: e.target.value })} />}
      </Field>
      <div className="field field-check form-wide">
        <input
          id="credit-hold"
          type="checkbox"
          checked={form.hold}
          onChange={(e) => set({ hold: e.target.checked })}
        />
        <label htmlFor="credit-hold">{t('On credit hold — no new orders confirm until lifted')}</label>
      </div>
      {form.hold && (
        <Field label={t('Reason for the hold')} wide>
          {(props) => <input {...props} maxLength={500} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />}
        </Field>
      )}
    </FormDialog>
  );
}

// ---- Profile ----

type Tab = 'overview' | 'orders' | 'payments' | 'credit' | 'profit';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'orders', label: 'Orders' },
  { value: 'payments', label: 'Payments' },
  { value: 'credit', label: 'Credit' },
  { value: 'profit', label: 'Profit' },
];

/** The status pill on a customer's card and profile. */
function customerStatus(c: Pick<CustomerCard, 'status' | 'creditHold' | 'overdue' | 'creditRisk'>): { label: string; tone: CardTone } {
  if (c.status === 'archived') return { label: 'Archived', tone: 'muted' };
  if (c.creditHold) return { label: 'On hold', tone: 'bad' };
  if (Number(c.overdue ?? 0) > 0) return { label: 'Overdue', tone: 'bad' };
  if (c.creditRisk) return { label: 'Credit risk', tone: 'pending' };
  return { label: 'Active', tone: 'done' };
}

/** "▲ 12%" against the 30 days before; nothing when there's nothing to compare with. */
function change(last: string, previous: string): string | null {
  const p = Number(previous);
  if (p <= 0) return null;
  const pct = Math.round(((Number(last) - p) / p) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
}

function NoAccess({ what }: { what: string }) {
  const t = useT();
  return <p className="muted">{t("Your role doesn't include {what}.", { what: t(what) })}</p>;
}

/**
 * Customer Profile (client design V1.1, screen 11): who they are and
 * where, how they buy and pay, and everything the owner does with them —
 * call, WhatsApp, navigate, edit, a new order, a payment, credit terms.
 */
function CustomerProfilePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const { data: session } = useSession();
  const canSeeFinance = hasPermission(session, 'finance:read');
  const canWrite = hasPermission(session, 'customers:write');
  const canSetCredit = hasPermission(session, 'customers:credit');
  const canCollect = hasPermission(session, 'finance:collect');
  const canOrder = hasPermission(session, 'orders:write');
  const profile = useCustomerProfile(id);
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<'edit' | 'credit' | 'archive' | 'payment' | 'qr' | null>(null);
  const close = () => setOpen(null);
  const customer = profile.data?.customer;
  const archived = customer?.status === 'archived';
  const toggle = useAction(
    () => apiSend<CustomerRecord>('POST', `customers/${id}/${archived ? 'restore' : 'archive'}`),
    [...CUSTOMER_EFFECTS, ['customers', 'profile', id]],
    close,
  );

  if (profile.isPending || profile.error) {
    return (
      <DetailPanel title={t('Customer')} onClose={onClose}>
        {profile.isPending ? <SkeletonLines lines={6} /> : <ErrorState error={profile.error} onRetry={() => profile.refetch()} />}
      </DetailPanel>
    );
  }
  const { money, orders, routeName, pin } = profile.data;
  const c = profile.data.customer;
  const status = customerStatus({ status: c.status, creditHold: c.creditHold, overdue: money?.overdue ?? null, creditRisk: money?.creditRisk ?? null });
  const sub = [c.place ?? routeName, t('Since {year}', { year: new Date(c.createdAt).getFullYear() })].filter(Boolean).join(' · ');

  return (
    <DetailPanel title={c.name} onClose={onClose}>
      <ProfileHead name={c.name} sub={sub} rating={money?.score} status={status.label} tone={status.tone} />
      {c.creditHold && (
        <p className="action-note" data-tone="bad">
          <strong>{t('On credit hold')}</strong>
          {c.creditHoldReason ? ` — ${c.creditHoldReason}` : ''}. {t("Orders for this customer won't confirm until the hold is lifted.")}
        </p>
      )}
      <div className="trip-tabs">
        <FilterTabs label="Customer details" options={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
      </div>

      {tab === 'overview' && (
        <>
          <StatTiles
            items={[
              ...(money
                ? [
                    {
                      label: 'Total Sales',
                      value: (
                        <>
                          {formatMoney(money.totalSales, currency)}
                          {change(money.salesLast30Days, money.salesPrevious30Days) && (
                            <small className="stat-tile-note"> {change(money.salesLast30Days, money.salesPrevious30Days)}</small>
                          )}
                        </>
                      ),
                    },
                    { label: 'Outstanding', value: formatMoney(money.outstanding, currency), tone: Number(money.overdue) > 0 ? ('bad' as const) : undefined },
                  ]
                : []),
              { label: 'Credit Limit', value: formatMoney(c.creditLimit, currency) },
              { label: 'Payment Terms', value: termsLabel(c.paymentTermsDays, t) },
              ...(money
                ? [
                    { label: 'Customer Score', value: money.score === null ? '—' : `★ ${money.score.toFixed(1)} / 5` },
                    { label: 'Avg. Payment Days', value: money.avgPaymentDays === null ? '—' : t('{n} days', { n: money.avgPaymentDays }) },
                  ]
                : []),
            ]}
          />
          <ContactActions phone={c.contact.phone} pin={pin} address={c.address ?? c.place} />
          <KeyValues
            items={[
              ['Address', c.address ?? '—'],
              ['Route', routeName ?? '—'],
              ['Phone', c.contact.phone ?? '—'],
              ['Email', c.contact.email ?? '—'],
              ['Language', languageName(c.preferredLanguage)],
              ...(money ? ([['On-time payments', money.onTimePct === null ? '—' : `${money.onTimePct}%`]] as [string, string][]) : []),
            ]}
          />
          {c.contact.notes && <p className="muted">{c.contact.notes}</p>}
          <ActionBar>
            {canOrder && !archived && (
              <Link className="button button-primary" href={`/orders?new=1&customer=${c.id}`}>
                {t('New Order')}
              </Link>
            )}
            {canWrite && !archived && (
              <button type="button" className="button" onClick={() => setOpen('edit')}>
                {t('Edit details')}
              </button>
            )}
            {canCollect && !archived && (
              <button type="button" className="button" onClick={() => setOpen('payment')}>
                {t('Record payment')}
              </button>
            )}
            {canSetCredit && !archived && (
              <button type="button" className="button" onClick={() => setOpen('credit')}>
                {t('Credit terms')}
              </button>
            )}
            {!archived && !c.isWalkIn && (
              <button type="button" className="button" onClick={() => setOpen('qr')}>
                {t('Delivery QR')}
              </button>
            )}
            {canWrite && (
              <button type="button" className={archived ? 'button' : 'button button-danger'} onClick={() => setOpen('archive')}>
                {archived ? t('Restore') : t('Archive')}
              </button>
            )}
          </ActionBar>
        </>
      )}

      {tab === 'orders' &&
        (orders ? (
          <>
            <StatTiles
              items={[
                { label: 'Orders', value: String(orders.count) },
                { label: 'Avg. Order Value', value: orders.avgOrderValue ? formatMoney(orders.avgOrderValue, currency) : '—' },
                { label: 'Last order', value: orders.lastOrderAt ? formatDateTime(orders.lastOrderAt, timeZone) : '—' },
              ]}
            />
            <h3 className="detail-subhead">{t('Recent Orders')}</h3>
            {orders.recent.length === 0 ? (
              <p className="muted">{t('No orders yet.')}</p>
            ) : (
              <ul className="plain-list party-rows">
                {orders.recent.map((o) => (
                  <li key={o.id}>
                    <span>
                      <strong>{formatOrderNumber(o.number)}</strong> <span className="muted">· {formatDate(o.day)}</span>
                    </span>
                    <span className="num">{formatMoney(o.total, currency)}</span>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
            {canOrder && !archived && (
              <ActionBar>
                <Link className="button button-primary" href={`/orders?new=1&customer=${c.id}`}>
                  {t('New Order')}
                </Link>
              </ActionBar>
            )}
          </>
        ) : (
          <NoAccess what="orders" />
        ))}

      {tab === 'payments' && (canSeeFinance ? <PaymentsTab customer={c} canCollect={canCollect && !archived} onRecord={() => setOpen('payment')} /> : <NoAccess what="finance" />)}

      {tab === 'credit' && <CreditTab customer={c} money={money} canSetCredit={canSetCredit && !archived} onChange={() => setOpen('credit')} />}

      {tab === 'profit' &&
        (money ? (
          <>
            <StatTiles
              items={[
                { label: 'Sales (before GST)', value: formatMoney(money.revenue, currency) },
                { label: 'Cost of goods', value: formatMoney(money.costOfGoods, currency) },
                { label: 'Gross margin', value: formatMoney(money.grossMargin, currency), tone: Number(money.grossMargin) < 0 ? 'bad' : undefined },
                { label: 'Margin', value: money.grossMarginPct === null ? '—' : `${money.grossMarginPct}%` },
              ]}
            />
            <h3 className="detail-subhead">{t('What they buy')}</h3>
            {money.topProducts.length === 0 ? (
              <p className="muted">{t('Nothing invoiced yet.')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('Product')}</th>
                      <th className="align-right">{t('Quantity')}</th>
                      <th className="align-right">{t('Sales')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.topProducts.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num">{formatQuantity(p.quantity, p.uom)}</td>
                        <td className="num">{formatMoney(p.revenue, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="footnote">{t('All time. Cost of goods is the cost of the stock delivered to them, recorded at delivery.')}</p>
          </>
        ) : (
          <NoAccess what="finance" />
        ))}

      {open === 'edit' && <EditCustomerDialog customer={c} onClose={close} />}
      {open === 'credit' && <CreditTermsDialog customer={c} onClose={close} />}
      {open === 'payment' && <CustomerPaymentDialog customerId={c.id} customerName={c.name} currency={currency} onClose={close} />}
      {open === 'qr' && <DeliveryQrDialog customer={c} canWrite={canWrite} invalidates={[...CUSTOMER_EFFECTS, ['customers', 'profile', id]]} onClose={close} />}
      {open === 'archive' && (
        <FormDialog
          title={archived ? t('Restore {name}?', { name: c.name }) : t('Archive {name}?', { name: c.name })}
          description={
            <p>
              {archived
                ? t('They can be chosen for new orders again.')
                : t('They stop appearing when placing new orders. Their history and anything they owe stay as they are.')}
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

/** Their invoices and payments for the last 90 days, with the running balance. */
function PaymentsTab({ customer, canCollect, onRecord }: { customer: CustomerRecord; canCollect: boolean; onRecord: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const statement = useCustomerStatement(customer.id, 90, true);
  if (statement.isPending) return <SkeletonLines lines={4} />;
  if (statement.error) return <ErrorState error={statement.error} onRetry={() => statement.refetch()} />;
  const s = statement.data;
  return (
    <>
      <KeyValues
        items={[
          ['Owed 90 days ago', formatMoney(s.openingBalance, currency)],
          ['Owed now', formatMoney(s.closingBalance, currency)],
        ]}
      />
      <h3 className="detail-subhead">{t('Invoices and payments, last 90 days')}</h3>
      {s.lines.length === 0 ? (
        <p className="muted">{t('Nothing in the last 90 days.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('When')}</th>
                <th>{t('What')}</th>
                <th className="align-right">{t('Invoiced')}</th>
                <th className="align-right">{t('Paid')}</th>
                <th className="align-right">{t('Balance')}</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={`${l.reference}-${i}`}>
                  <td>{formatDateTime(l.at, timeZone)}</td>
                  <td>
                    {l.reference}
                    <span className="muted"> · {l.description}</span>
                  </td>
                  <td className="num">{Number(l.debit) > 0 ? formatMoney(l.debit, currency) : ''}</td>
                  <td className="num">{Number(l.credit) > 0 ? formatMoney(l.credit, currency) : ''}</td>
                  <td className="num">{formatMoney(l.balance, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canCollect && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={onRecord}>
            {t('Record payment')}
          </button>
        </ActionBar>
      )}
    </>
  );
}

/** Credit: the terms, what's in use, what's overdue by age, and whether they're a risk. */
function CreditTab({
  customer,
  money,
  canSetCredit,
  onChange,
}: {
  customer: CustomerRecord;
  money: CustomerProfile['money'];
  canSetCredit: boolean;
  onChange: () => void;
}) {
  const t = useT();
  const currency = useCurrency();
  const credit = useCustomerCredit(customer.id, money !== null);
  const receivables = useReceivables(money !== null);
  const receivable = receivables.data?.customers.find((r) => r.customerId === customer.id);
  return (
    <>
      <KeyValues
        items={[
          ['Credit limit', formatMoney(customer.creditLimit, currency)],
          ['Payment terms', termsLabel(customer.paymentTermsDays, t)],
          [
            'Finance charge',
            Number(customer.financeChargeRateAnnual) > 0
              ? t("{rate}% a year (÷ 365 per day) after {days} days' grace", { rate: customer.financeChargeRateAnnual, days: customer.financeChargeGraceDays })
              : t('None'),
          ],
          ['Credit hold', customer.creditHold ? t('Yes') : t('No')],
          ...(money
            ? ([
                ['Credit available', credit.data ? formatMoney(credit.data.available, currency) : formatMoney(money.available, currency)],
                ['Confirmed, not delivered', formatMoney(money.openOrderValue, currency)],
                ['Held on account', formatMoney(money.onAccount, currency)],
              ] as [string, string][])
            : []),
        ]}
      />
      {money?.creditRisk && (
        <p className="action-note" data-tone="bad">
          <strong>{t('Credit risk')}</strong> —{' '}
          {t('on credit hold, an invoice more than 30 days overdue, or 90% or more of the credit limit in use.')}
        </p>
      )}
      {receivable && (
        <>
          <h3 className="detail-subhead">{t("What's owed, by age")}</h3>
          <AgingBar receivable={receivable} currency={currency} />
        </>
      )}
      {canSetCredit && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={onChange}>
            {t('Credit terms')}
          </button>
        </ActionBar>
      )}
    </>
  );
}

// ---- The list ----

const FILTERS: { value: CustomersFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'credit', label: 'Credit risk' },
  { value: 'overdue', label: 'Overdue' },
];

/** The Customers list (client design V1.1, screen 10). */
export default function CustomersPage() {
  const t = useT();
  const [filter, setFilter] = useState<CustomersFilter>('all');
  const [routeId, setRouteId] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useOpenOnNew(() => setCreating(true));
  // ?open=<id> (from Collections' View) opens that customer's profile.
  const params = useSearchParams();
  const opening = params.get('open');
  useEffect(() => {
    if (opening) setSelected(opening);
  }, [opening]);
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'customers:write');
  const currency = useCurrency();
  const routes = useRoutes();
  const board = useCustomersBoard(filter, routeId, query);
  const counts = board.data?.counts;

  return (
    <div className="list-split">
      <div className="list-screen">
        <h1 className="page-title visually-hidden">{t('Customers')}</h1>
        {creating && (
          <NewCustomerDialog
            onClose={() => setCreating(false)}
            onCreated={(customer) => {
              setCreating(false);
              setSelected(customer.id);
            }}
          />
        )}
        <SearchFilter
          value={query}
          onChange={setQuery}
          placeholder="Search customer name, mobile…"
          filter={{
            value: routeId,
            onChange: setRouteId,
            label: 'By route',
            options: [{ value: '', label: 'All routes' }, ...(routes.data ?? []).map((r) => ({ value: r.id, label: r.name }))],
          }}
        />
        <DayTabs
          label="Which customers"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setSelected(null);
          }}
          options={FILTERS.filter((f) => f.value === 'all' || f.value === 'active' || counts?.[f.value] !== null).map((f) => ({
            ...f,
            count: counts?.[f.value] ?? undefined,
          }))}
        />
        {board.isPending ? (
          <SkeletonLines lines={5} height={64} />
        ) : board.error ? (
          <div className="panel">
            <ErrorState error={board.error} onRetry={() => board.refetch()} />
          </div>
        ) : (
          <div className="card-list" data-updating={board.isPlaceholderData || undefined}>
            {board.data.items.length === 0 && <div className="list-empty">{query || routeId || filter !== 'all' ? t('Nothing matches.') : t('No customers yet.')}</div>}
            {board.data.items.map((c) => {
              const status = customerStatus(c);
              return (
                <PartyCard
                  key={c.id}
                  name={c.name}
                  sub={[c.place, c.routeName].filter(Boolean).join(' · ') || null}
                  amount={c.totalSales !== null ? formatMoney(c.totalSales, currency) : null}
                  amountNote={
                    Number(c.overdue ?? 0) > 0
                      ? t('{amount} overdue', { amount: formatMoney(c.overdue!, currency) })
                      : Number(c.outstanding ?? 0) > 0
                        ? t('Owes {amount}', { amount: formatMoney(c.outstanding!, currency) })
                        : null
                  }
                  amountTone={Number(c.overdue ?? 0) > 0 ? 'bad' : undefined}
                  rating={c.score}
                  status={status.label}
                  tone={status.tone}
                  selected={selected === c.id}
                  onOpen={() => setSelected(c.id)}
                />
              );
            })}
          </div>
        )}
        {canWrite && <CreateBar label="Add Customer" onClick={() => setCreating(true)} />}
      </div>
      {selected && <CustomerProfilePanel key={selected} id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
