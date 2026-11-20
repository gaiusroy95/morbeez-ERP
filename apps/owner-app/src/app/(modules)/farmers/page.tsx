'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { FarmerCard, FarmerRecord, FarmersFilter } from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FilterTabs } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { FarmerPaymentDialog, METHOD_LABEL } from '@/components/forms/PaymentDialogs';
import { apiSend } from '@/lib/api/client';
import { OpeningBalanceDialog, OpeningBalanceField, OpeningBalanceLine, parseOpening, postOpeningBalance, useCanPostOpening } from '@/components/finance/OpeningBalance';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { optionalText } from '@/lib/parse';
import { useT, type Translate } from '@/lib/i18n';
import { useOpenOnNew, useOpenParam } from '@/lib/hooks/use-open-on-new';
import { formatPoNumber } from '@/lib/hooks/use-procurement';
import { useFarmerProfile, useFarmersBoard } from '@/lib/hooks/use-parties';
import { CreateBar, DayTabs, SearchFilter, type CardTone } from '@/components/redesign/ListCards';
import { ContactActions, PartyCard, ProfileHead, StatTiles } from '@/components/redesign/Party';

// The list here, the pick-lists (purchase orders, pickups) and the views that name farmers.
const REFRESH = [['farmers'], ['lookup', 'farmers'], KEYS.procurement, KEYS.finance];

type Tab = 'overview' | 'purchases' | 'payments';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'purchases', label: 'Purchases' },
  { value: 'payments', label: 'Payments' },
];

function farmerStatus(f: Pick<FarmerCard, 'status' | 'owed'>): { label: string; tone: CardTone } {
  if (f.status === 'archived') return { label: 'Archived', tone: 'muted' };
  if (Number(f.owed ?? 0) > 0) return { label: 'Payment due', tone: 'pending' };
  return { label: 'Active', tone: 'done' };
}

/** Master Spec §12: Net terms are these days; Custom any 1–180. */
const NET_DAYS = [3, 7, 10, 15, 20, 30, 45, 60];

/** The farmer's payment terms in words. */
function farmerTermsLabel(f: Pick<FarmerRecord, 'paymentTerms' | 'paymentTermsDays'>, t: Translate): string {
  if (f.paymentTerms === 'immediate') return t('Immediate');
  if (f.paymentTerms === 'bill_to_bill') return t('Bill-to-Bill (at most {n} days)', { n: f.paymentTermsDays ?? 0 });
  if (f.paymentTerms === 'net') return t('Net {n}', { n: f.paymentTermsDays ?? 0 });
  return t('{n} days', { n: f.paymentTermsDays ?? 0 });
}

/**
 * Farmer profile (client design, Farmers): where they are and what they
 * sell, what was bought from them and what they're still owed — with Call,
 * WhatsApp, Navigate, a new procurement and paying them.
 */
function FarmerProfilePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'farmers:write');
  const canBuy = hasPermission(session, 'procurement:write');
  const canPay = hasPermission(session, 'finance:pay');
  const profile = useFarmerProfile(id);
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<'edit' | 'pay' | 'archive' | 'opening' | null>(null);
  const close = () => setOpen(null);
  const canPostOpening = useCanPostOpening();
  const archived = profile.data?.farmer.status === 'archived';
  const toggle = useAction(() => apiSend<FarmerRecord>('POST', `farmers/${id}/${archived ? 'restore' : 'archive'}`), REFRESH, close);

  if (profile.isPending || profile.error) {
    return (
      <DetailPanel title={t('Farmer')} onClose={onClose}>
        {profile.isPending ? <SkeletonLines lines={6} /> : <ErrorState error={profile.error} onRetry={() => profile.refetch()} />}
      </DetailPanel>
    );
  }
  const { farmer: f, money, purchases, routeName, pin } = profile.data;
  const main = purchases?.products[0]?.name ?? null;
  const status = farmerStatus({ status: f.status, owed: money?.owed ?? null });

  return (
    <DetailPanel title={f.name} onClose={onClose}>
      <ProfileHead name={f.name} sub={[f.place, main].filter(Boolean).join(' · ') || null} status={status.label} tone={status.tone} />
      <div className="trip-tabs">
        <FilterTabs label="Farmer details" options={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
      </div>

      {tab === 'overview' && (
        <>
          {money && (
            <StatTiles
              items={[
                { label: 'Total Purchases', value: formatMoney(money.totalPurchases, currency) },
                { label: 'Balance', value: formatMoney(money.owed, currency), tone: Number(money.owed) > 0 ? 'bad' : undefined },
                { label: 'Paid to date', value: formatMoney(money.paid, currency) },
                ...(Number(money.advance) > 0 ? [{ label: 'Paid ahead', value: formatMoney(money.advance, currency) }] : []),
              ]}
            />
          )}
          <ContactActions phone={f.contact?.phone} pin={pin} address={f.place} />
          <KeyValues
            items={[
              ['Place', f.place ?? '—'],
              ['Payment terms', farmerTermsLabel(f, t)],
              ['Route', routeName ?? '—'],
              ['Phone', f.contact?.phone ?? '—'],
              ['Main product', main ?? '—'],
              ...(purchases ? ([['Last pickup', formatDateTime(purchases.lastPickupAt, timeZone)]] as [string, string][]) : []),
              ...(money ? ([['Opening balance', <OpeningBalanceLine key="ob" opening={money.openingBalance} currency={currency} />]] as [string, React.ReactNode][]) : []),
            ]}
          />
          {f.contact?.notes && <p className="muted">{f.contact.notes}</p>}
          <ActionBar>
            {canBuy && !archived && (
              <Link className="button button-primary" href={`/procurement?new=1&farmer=${f.id}`}>
                {t('New Procurement')}
              </Link>
            )}
            {canPay && money && Number(money.owed) > 0 && (
              <button type="button" className="button" onClick={() => setOpen('pay')}>
                {t('Pay {name}', { name: f.name })}
              </button>
            )}
            {canWrite && !archived && (
              <button type="button" className="button" onClick={() => setOpen('edit')}>
                {t('Edit')}
              </button>
            )}
            {canPostOpening && money && !money.openingBalance && !archived && (
              <button type="button" className="button" onClick={() => setOpen('opening')}>
                {t('Opening balance')}
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

      {tab === 'purchases' &&
        (purchases ? (
          <>
            <StatTiles
              items={[
                { label: 'Purchase orders', value: String(purchases.count) },
                { label: 'Open', value: String(purchases.open) },
              ]}
            />
            <h3 className="detail-subhead">{t('What they sell')}</h3>
            {purchases.products.length === 0 ? (
              <p className="muted">{t('Nothing graded yet.')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('Product')}</th>
                      <th className="align-right">{t('Quantity')}</th>
                      <th className="align-right">{t('Value')}</th>
                      <th className="align-right">{t('Avg. rate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.products.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num">{formatQuantity(p.quantity, p.uom)}</td>
                        <td className="num">{formatMoney(p.value, currency)}</td>
                        <td className="num">{p.avgRate ? `${formatMoney(p.avgRate, currency)} / ${p.uom}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 className="detail-subhead">{t('Recent purchase orders')}</h3>
            {purchases.recent.length === 0 ? (
              <p className="muted">{t('No purchase orders yet.')}</p>
            ) : (
              <ul className="plain-list party-rows">
                {purchases.recent.map((po) => (
                  <li key={po.id}>
                    <span>
                      <strong>{formatPoNumber(po.number)}</strong> <span className="muted">· {formatDate(po.day)} · {formatQuantity(po.kg, 'kg')}</span>
                    </span>
                    <span className="num">{formatMoney(po.value, currency)}</span>
                    <StatusBadge status={po.status} />
                  </li>
                ))}
              </ul>
            )}
            {canBuy && !archived && (
              <ActionBar>
                <Link className="button button-primary" href={`/procurement?new=1&farmer=${f.id}`}>
                  {t('New Procurement')}
                </Link>
              </ActionBar>
            )}
          </>
        ) : (
          <p className="muted">{t("Your role doesn't include {what}.", { what: t('procurement') })}</p>
        ))}

      {tab === 'payments' &&
        (money ? (
          <>
            <StatTiles
              items={[
                { label: 'Balance', value: formatMoney(money.owed, currency), tone: Number(money.owed) > 0 ? 'bad' : undefined },
                { label: 'Paid to date', value: formatMoney(money.paid, currency) },
                { label: 'Unpaid since', value: money.oldestUnpaidAt ? formatDate(money.oldestUnpaidAt.slice(0, 10)) : '—' },
                { label: 'Overdue', value: formatMoney(money.overdue, currency), tone: Number(money.overdue) > 0 ? 'bad' : undefined },
                { label: 'Avg. Payment Days', value: money.avgPaymentDays === null ? '—' : t('{n} days', { n: money.avgPaymentDays }) },
              ]}
            />
            <h3 className="detail-subhead">{t('Payments')}</h3>
            {money.payments.length === 0 ? (
              <p className="muted">{t('No payments yet.')}</p>
            ) : (
              <ul className="plain-list party-rows">
                {money.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {formatDateTime(p.paidAt, timeZone)}
                      <span className="muted">
                        {' '}
                        · {t(METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method)}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </span>
                    </span>
                    <span className="num">{formatMoney(p.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canPay && Number(money.owed) > 0 && (
              <ActionBar>
                <button type="button" className="button button-primary" onClick={() => setOpen('pay')}>
                  {t('Pay {name}', { name: f.name })}
                </button>
              </ActionBar>
            )}
          </>
        ) : (
          <p className="muted">{t("Your role doesn't include {what}.", { what: t('finance') })}</p>
        ))}

      {open === 'edit' && <FarmerDialog farmer={f} onClose={close} />}
      {open === 'opening' && <OpeningBalanceDialog party="farmer" id={f.id} name={f.name} onClose={close} />}
      {open === 'pay' && <FarmerPaymentDialog farmerId={f.id} farmerName={f.name} currency={currency} onClose={close} />}
      {open === 'archive' && (
        <FormDialog
          title={archived ? t('Restore {name}?', { name: f.name }) : t('Archive {name}?', { name: f.name })}
          description={
            <p>{archived ? t('They can be chosen on purchase orders again.') : t('They stop appearing on new purchase orders. Their history and anything owed stay as they are.')}</p>
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

const FILTERS: { value: FarmersFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending Payment' },
  { value: 'active', label: 'Active' },
];

/** The Farmers list (client design V1.1, screen 12). */
export default function FarmersPage() {
  const t = useT();
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'farmers:write');
  const currency = useCurrency();
  const [filter, setFilter] = useState<FarmersFilter>('all');
  const [place, setPlace] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useOpenOnNew(() => setAdding(true));
  useOpenParam(setSelected);
  const board = useFarmersBoard(filter, place, query);
  const counts = board.data?.counts;

  if (session && !hasPermission(session, 'farmers:read')) {
    return (
      <div className="panel placeholder">
        <strong>{t("Your role doesn't include farmers.")}</strong>
      </div>
    );
  }

  return (
    <div className="list-split">
      <div className="list-screen">
        <h1 className="page-title visually-hidden">{t('Farmers')}</h1>
        <SearchFilter
          value={query}
          onChange={setQuery}
          placeholder="Search farmer name, mobile…"
          filter={{
            value: place,
            onChange: setPlace,
            label: 'By Location',
            options: [{ value: '', label: 'All places' }, ...(board.data?.places ?? []).map((p) => ({ value: p.place, label: `${p.place} (${p.farmers})` }))],
          }}
        />
        <DayTabs
          label="Which farmers"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setSelected(null);
          }}
          options={FILTERS.filter((f) => f.value !== 'pending' || counts?.pending !== null).map((f) => ({ ...f, count: counts?.[f.value] ?? undefined }))}
        />
        {board.isPending ? (
          <SkeletonLines lines={5} height={64} />
        ) : board.error ? (
          <div className="panel">
            <ErrorState error={board.error} onRetry={() => board.refetch()} />
          </div>
        ) : (
          <div className="card-list" data-updating={board.isPlaceholderData || undefined}>
            {board.data.items.length === 0 && <div className="list-empty">{query || place || filter !== 'all' ? t('Nothing matches.') : t('No farmers yet.')}</div>}
            {board.data.items.map((f) => {
              const owed = Number(f.owed ?? 0);
              return (
                <PartyCard
                  key={f.id}
                  name={f.name}
                  sub={[f.place, f.mainProduct].filter(Boolean).join(' · ') || null}
                  amount={f.totalPurchases !== null && Number(f.totalPurchases) > 0 ? formatMoney(f.totalPurchases, currency) : null}
                  amountNote={
                    f.owed === null ? null : owed > 0 ? t('Balance: {amount}', { amount: formatMoney(f.owed, currency) }) : Number(f.totalPurchases) > 0 ? t('Settled') : null
                  }
                  amountTone={owed > 0 ? 'bad' : 'good'}
                  status={f.status === 'archived' ? 'Archived' : null}
                  tone="muted"
                  selected={selected === f.id}
                  onOpen={() => setSelected(f.id)}
                />
              );
            })}
          </div>
        )}
        {canWrite && <CreateBar label="Add Farmer" onClick={() => setAdding(true)} />}
      </div>
      {selected && <FarmerProfilePanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      {adding && <FarmerDialog farmer={null} onClose={() => setAdding(false)} onSaved={(f) => setSelected(f.id)} />}
    </div>
  );
}

function FarmerDialog({ farmer, onClose, onSaved }: { farmer: FarmerRecord | null; onClose: () => void; onSaved?: (farmer: FarmerRecord) => void }) {
  const t = useT();
  const [form, setForm] = useState({
    name: farmer?.name ?? '',
    phone: farmer?.contact?.phone ?? '',
    place: farmer?.place ?? '',
    notes: farmer?.contact?.notes ?? '',
    holder: '',
    account: '',
    ifsc: '',
    terms: !farmer || farmer.paymentTerms === 'immediate' ? 'immediate' : farmer.paymentTerms === 'net' ? `net:${farmer.paymentTermsDays}` : farmer.paymentTerms,
    days: farmer?.paymentTermsDays && farmer.paymentTerms !== 'net' ? String(farmer.paymentTermsDays) : '',
    opening: '',
  });
  const canPostOpening = useCanPostOpening() && !farmer;
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  // Added, but the opening balance didn't go: the next tap sends only that — never a second farmer.
  const [added, setAdded] = useState<FarmerRecord | null>(null);
  const save = useAction(
    async ({ body, opening }: { body: Record<string, unknown>; opening?: number }) => {
      if (farmer) return apiSend<FarmerRecord>('PATCH', `farmers/${farmer.id}`, body);
      const created = added ?? (await apiSend<FarmerRecord>('POST', 'farmers', body));
      setAdded(created);
      if (opening === undefined) return created;
      try {
        await postOpeningBalance('farmer', created.id, { amount: opening });
      } catch (e) {
        throw new Error(
          t('{name} is added, but the opening balance didn’t go: {reason} Try again, or clear it.', { name: created.name, reason: e instanceof Error ? e.message : String(e) }),
        );
      }
      return created;
    },
    REFRESH,
    (saved: FarmerRecord) => {
      onSaved?.(saved);
      onClose();
    },
  );
  const queries = useQueryClient();
  const close = () => {
    if (added) {
      for (const key of REFRESH) void queries.invalidateQueries({ queryKey: key });
      onSaved?.(added);
    }
    onClose();
  };

  const submit = () => {
    if (form.name.trim().length < 2) return setProblem(t("Enter the farmer's name (at least 2 characters)."));
    // Bank details are optional, but all three or none.
    const holder = form.holder.trim();
    const account = form.account.replace(/\s/g, '');
    const ifsc = form.ifsc.trim().toUpperCase();
    const anyBank = holder || account || ifsc;
    if (anyBank) {
      if (holder.length < 2 || !/^\d{6,20}$/.test(account) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        return setProblem(t('Bank details need the account holder, a 6–20 digit account number and an IFSC code (like SBIN0001234) — or leave all three blank.'));
      }
    }
    const needsDays = form.terms === 'bill_to_bill' || form.terms === 'custom';
    const days = Number(form.days);
    if (needsDays && !(Number.isInteger(days) && days >= 1 && days <= 180)) return setProblem(t('Enter the days — a whole number from 1 to 180.'));
    const opening = canPostOpening ? parseOpening(form.opening) : ({ ok: true, value: undefined } as const);
    if (!opening.ok) return setProblem(opening.error);
    const [paymentTerms, netDays] = form.terms.startsWith('net:') ? ['net', Number(form.terms.slice(4))] : [form.terms, needsDays ? days : undefined];
    setProblem(null);
    const body: Record<string, unknown> = {
      paymentTerms,
      ...(netDays !== undefined ? { paymentTermsDays: netDays } : {}),
      name: form.name.trim(),
      place: form.place.trim() || null,
      contact: { phone: optionalText(form.phone), notes: optionalText(form.notes) },
      ...(anyBank ? { bankDetails: { accountHolderName: holder, accountNumber: account, ifscCode: ifsc } } : {}),
    };
    save.mutate(farmer ? { body: { version: farmer.version, ...body } } : { body, opening: opening.value });
  };

  return (
    <FormDialog
      title={farmer ? t('Edit {name}', { name: farmer.name }) : t('Add a farmer')}
      submitLabel={farmer ? t('Save') : added ? t('Try again') : t('Add farmer')}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={close}
      onSubmit={submit}
    >
      <Field label={t('Name')} wide>
        {(p) => <input {...p} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
      </Field>
      <Field label={t('Village / town (optional)')}>
        {(p) => <input {...p} maxLength={120} value={form.place} onChange={(e) => set({ place: e.target.value })} />}
      </Field>
      <Field label={t('Phone (optional)')}>
        {(p) => <input {...p} type="tel" maxLength={20} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}
      </Field>
      <Field label={t('Payment terms')} hint={t('When a graded lot falls due — new lots only; owed lots keep their due dates')}>
        {(p) => (
          <select {...p} value={form.terms} onChange={(e) => set({ terms: e.target.value })}>
            <option value="immediate">{t('Immediate')}</option>
            <option value="bill_to_bill">{t('Bill-to-Bill — due at the next pickup')}</option>
            {NET_DAYS.map((n) => (
              <option key={n} value={`net:${n}`}>
                {t('Net {n}', { n })}
              </option>
            ))}
            <option value="custom">{t('Custom')}</option>
          </select>
        )}
      </Field>
      {(form.terms === 'bill_to_bill' || form.terms === 'custom') && (
        <Field label={form.terms === 'custom' ? t('Days to pay') : t('Longest a payable may wait (days)')}>
          {(p) => <input {...p} inputMode="numeric" value={form.days} onChange={(e) => set({ days: e.target.value })} />}
        </Field>
      )}
      <Field label={t('Notes (optional)')}>
        {(p) => <input {...p} maxLength={500} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
      </Field>
      {canPostOpening && <OpeningBalanceField party="farmer" value={form.opening} onChange={(opening) => set({ opening })} />}
      <Field
        label={t('Bank account holder (optional)')}
        hint={farmer ? t('Blank keeps the bank details already saved') : t('For paying the farmer by bank; can be added later')}
        wide
      >
        {(p) => <input {...p} value={form.holder} onChange={(e) => set({ holder: e.target.value })} />}
      </Field>
      <Field label={t('Account number')}>
        {(p) => <input {...p} inputMode="numeric" autoComplete="off" value={form.account} onChange={(e) => set({ account: e.target.value })} />}
      </Field>
      <Field label={t('IFSC code')}>
        {(p) => <input {...p} autoComplete="off" value={form.ifsc} onChange={(e) => set({ ifsc: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}
