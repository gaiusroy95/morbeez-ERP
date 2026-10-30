'use client';

import { useState } from 'react';
import type { BackhaulPaymentBody, BackhaulPaymentMethod, BackhaulRecord, CreateBackhaulBody, TripRecord } from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useTripBackhauls } from '@/lib/hooks/use-trips';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatMoney, timeOf } from '@/lib/format';
import { firstError, optionalText, parseMoney } from '@/lib/parse';
import { useT } from '@/lib/i18n';

// The rent is income and cash rent is in the handover: Finance and the trip both change.
const EFFECTS = [KEYS.logistics, KEYS.finance, KEYS.dashboard];

const METHOD_LABEL: Record<BackhaulPaymentMethod, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer' };

function badgeOf(b: BackhaulRecord): { label: string; tone: Tone } {
  if (b.status === 'offered') return { label: 'Offered', tone: 'attention' };
  if (b.status === 'accepted') return { label: 'Under way', tone: 'active' };
  if (b.status === 'skipped') return { label: 'Skipped', tone: 'muted' };
  if (b.status === 'cancelled') return { label: 'Cancelled', tone: 'muted' };
  if (!b.payment) return { label: 'To be paid', tone: 'attention' };
  return Number(b.payment.amount) < Number(b.rent) ? { label: 'Paid short', tone: 'bad' } : { label: 'Paid', tone: 'done' };
}

/**
 * A trip's backhauls (driver app D5; client spec §16–§17): a fixed-rent job
 * on the way back — no product, no kilos, no stock. The owner offers one
 * (pickup, drop, rent) and the driver accepts or skips it, or the driver
 * adds one taken on the road; each step as the driver records it, and the
 * payment, booked as income.
 */
export function TripBackhaulView({ trip }: { trip: TripRecord }) {
  const t = useT();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const { data: session } = useSession();
  const canDispatch = hasPermission(session, 'logistics:dispatch');
  const backhauls = useTripBackhauls(trip.id);
  const [open, setOpen] = useState<{ kind: 'offer' } | { kind: 'cancel' | 'pay'; backhaul: BackhaulRecord } | null>(null);
  const close = () => setOpen(null);
  const canOffer = canDispatch && (trip.status === 'planned' || trip.status === 'in_progress') && trip.closingKm === null;
  const canPay = canDispatch && ['in_progress', 'completed', 'on_hold'].includes(trip.status);

  if (backhauls.isPending) return <SkeletonLines lines={4} />;
  if (backhauls.error) return <ErrorState error={backhauls.error} onRetry={() => backhauls.refetch()} />;
  const list = backhauls.data;
  const step = (label: string, at: string | null, extra = '') => (
    <li data-status={at ? 'completed' : 'pending'}>
      <span className="muted">{timeOf(at, timeZone) ?? '—'}</span>
      <span>
        {t(label)}
        {extra && <span className="muted"> · {extra}</span>}
      </span>
    </li>
  );

  return (
    <>
      {list.length === 0 && <p className="muted">{t('No backhaul on this trip.')}</p>}
      {list.map((b) => {
        const badge = badgeOf(b);
        const photos = (n: number) => (n === 1 ? t('1 photo') : t('{n} photos', { n }));
        return (
          <section key={b.id} className="backhaul-card" aria-label={`${b.pickupPlace} → ${b.dropPlace}`}>
            <div className="closure-head">
              <h3 className="detail-subhead">
                {b.pickupPlace} → {b.dropPlace}
              </h3>
              <StatusBadge status={b.status} tone={badge.tone} label={badge.label} />
            </div>
            <p className="muted">
              {t('Fixed rent')} {formatMoney(b.rent, currency)} · {b.offeredBy === 'owner' ? t('Offered by you') : t('Taken by the driver on the road')}
              {b.hirerName ? ` · ${t('Hired by {name}', { name: b.hirerName })}` : ''}
            </p>
            {b.notes && <p className="muted">{b.notes}</p>}
            {b.status === 'skipped' && <p className="action-note">{t('Skipped:')} {b.skipReason}</p>}
            {b.status === 'cancelled' && <p className="muted">{t('Cancelled')}{b.cancelReason ? `: ${b.cancelReason}` : ''}</p>}
            {(b.status === 'accepted' || b.status === 'completed') && (
              <ol className="backhaul-steps">
                {step('Accepted', b.acceptedAt)}
                {step('Pickup reached', b.pickupReachedAt)}
                {step('Load complete', b.loadedAt, b.photos.load ? photos(b.photos.load) : '')}
                {step('Drop reached', b.dropReachedAt)}
                {step('Completed', b.completedAt, b.photos.drop ? photos(b.photos.drop) : '')}
              </ol>
            )}
            {b.payment && (
              <p className={Number(b.payment.amount) < Number(b.rent) ? 'action-note' : 'muted'}>
                {t('{amount} received by {method}', { amount: formatMoney(b.payment.amount, currency), method: t(METHOD_LABEL[b.payment.method]) })}
                {Number(b.payment.amount) < Number(b.rent) && ` — ${t('{short} short of the rent', { short: formatMoney((Number(b.rent) - Number(b.payment.amount)).toFixed(2), currency) })}`}
                {b.payment.reference ? ` · ${t('Ref')} ${b.payment.reference}` : ''}
                {b.payment.note ? ` · ${b.payment.note}` : ''}
                {b.photos.payment ? ` · ${photos(b.photos.payment)}` : ''}
              </p>
            )}
            {b.status === 'completed' && !b.payment && <p className="action-note">{t('The rent has not been received yet.')}</p>}
            {canDispatch && (
              <ActionBar>
                {(b.status === 'offered' || b.status === 'accepted') && (
                  <button type="button" className="button button-danger" onClick={() => setOpen({ kind: 'cancel', backhaul: b })}>
                    {t('Cancel backhaul')}
                  </button>
                )}
                {canPay && b.status === 'completed' && !b.payment && (
                  <button type="button" className="button" onClick={() => setOpen({ kind: 'pay', backhaul: b })}>
                    {t('Record payment')}
                  </button>
                )}
              </ActionBar>
            )}
          </section>
        );
      })}
      {canOffer && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setOpen({ kind: 'offer' })}>
            {t('Offer backhaul')}
          </button>
        </ActionBar>
      )}
      <p className="footnote">{t('A backhaul carries no product, no KG and no stock. The rent is booked as income when it is paid; rent paid in cash is part of the driver’s handover.')}</p>

      {open?.kind === 'offer' && <OfferDialog trip={trip} onClose={close} />}
      {open?.kind === 'cancel' && <CancelDialog trip={trip} backhaul={open.backhaul} onClose={close} />}
      {open?.kind === 'pay' && <PaymentDialog trip={trip} backhaul={open.backhaul} onClose={close} />}
    </>
  );
}

function OfferDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const [pickup, setPickup] = useState('');
  const [drop, setDrop] = useState('');
  const [rent, setRent] = useState('');
  const [hirer, setHirer] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const offer = useAction((body: CreateBackhaulBody) => apiSend<BackhaulRecord>('POST', `logistics/trips/${trip.id}/backhauls`, body), EFFECTS, onClose);
  return (
    <FormDialog
      title={t('Offer a backhaul')}
      description={<p>{t('The driver sees it after the last delivery and accepts or skips it.')}</p>}
      submitLabel={t('Offer backhaul')}
      pending={offer.isPending}
      error={problem ?? offer.error}
      onClose={onClose}
      onSubmit={() => {
        const parsed = parseMoney(rent, 'the rent', true);
        const error = pickup.trim().length < 2 ? t('Say where to pick up.') : drop.trim().length < 2 ? t('Say where to drop.') : firstError([parsed]);
        if (error) return setProblem(error);
        setProblem(null);
        offer.mutate({
          pickupPlace: pickup.trim(),
          dropPlace: drop.trim(),
          rent: (parsed as { value: number }).value,
          hirerName: optionalText(hirer),
          notes: optionalText(notes),
        });
      }}
    >
      <Field label={t('Pickup')}>{(props) => <input {...props} value={pickup} onChange={(e) => setPickup(e.target.value)} />}</Field>
      <Field label={t('Drop')}>{(props) => <input {...props} value={drop} onChange={(e) => setDrop(e.target.value)} />}</Field>
      <Field label={`${t('Fixed rent')} (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} />}
      </Field>
      <Field label={t('Hired by (optional)')}>{(props) => <input {...props} value={hirer} onChange={(e) => setHirer(e.target.value)} />}</Field>
      <Field label={t('Note for the driver (optional)')} wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function CancelDialog({ trip, backhaul, onClose }: { trip: TripRecord; backhaul: BackhaulRecord; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const cancel = useAction(
    () => apiSend<BackhaulRecord>('POST', `logistics/trips/${trip.id}/backhauls/${backhaul.id}/cancel`, { reason: optionalText(reason) }),
    EFFECTS,
    onClose,
  );
  return (
    <FormDialog
      title={t('Cancel this backhaul?')}
      description={<p>{`${backhaul.pickupPlace} → ${backhaul.dropPlace}`}</p>}
      submitLabel={t('Cancel backhaul')}
      tone="danger"
      pending={cancel.isPending}
      error={cancel.error}
      onClose={onClose}
      onSubmit={() => cancel.mutate(undefined)}
    >
      <Field label={t('Reason (optional)')} wide>
        {(props) => <input {...props} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

/** Paid to the owner directly (a transfer, say): recorded here, it lets the driver hand over. */
function PaymentDialog({ trip, backhaul, onClose }: { trip: TripRecord; backhaul: BackhaulRecord; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const [method, setMethod] = useState<BackhaulPaymentMethod>('bank_transfer');
  const [amount, setAmount] = useState(backhaul.rent);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const pay = useAction(
    (body: BackhaulPaymentBody) => apiSend<BackhaulRecord>('POST', `logistics/trips/${trip.id}/backhauls/${backhaul.id}/payment`, body),
    EFFECTS,
    onClose,
  );
  return (
    <FormDialog
      title={t('Record the backhaul payment')}
      description={<p>{t('Rent {rent}. Cash counts in the driver’s handover; UPI and transfers came straight to you.', { rent: formatMoney(backhaul.rent, currency) })}</p>}
      submitLabel={t('Record payment')}
      pending={pay.isPending}
      error={problem ?? pay.error}
      onClose={onClose}
      onSubmit={() => {
        const parsed = parseMoney(amount, 'the amount received', true);
        if (!parsed.ok) return setProblem(parsed.error);
        if (parsed.value > Number(backhaul.rent)) return setProblem(t('Record no more than the rent.'));
        setProblem(null);
        pay.mutate({ method, amount: parsed.value, reference: optionalText(reference), note: optionalText(note) });
      }}
    >
      <Field label={t('Payment method')}>
        {(props) => (
          <select {...props} value={method} onChange={(e) => setMethod(e.target.value as BackhaulPaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as BackhaulPaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {t(METHOD_LABEL[m])}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`${t('Amount received')} (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      {method !== 'cash' && (
        <Field label={t('Reference (UTR)')}>{(props) => <input {...props} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      )}
      <Field label={t('Notes (optional)')} wide>
        {(props) => <input {...props} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
