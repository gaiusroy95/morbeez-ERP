'use client';

import { useState } from 'react';
import type {
  ChecklistArea,
  ChecklistItem,
  HandoverSummary,
  ReconcileTripBody,
  TripCashDepositRecord,
  TripDecisionBody,
  TripReconciliationRecord,
  TripRecord,
} from '@morbeez/shared-types';
import { SkeletonLines, ErrorState } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useTripReview } from '@/lib/hooks/use-modules';
import { useCurrency } from '@/lib/hooks/use-lookups';
import { formatDateTime, formatMoney } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';
import { firstError, optionalText, parseMoney } from '@/lib/parse';
import { useT } from '@/lib/i18n';

const EFFECTS = [KEYS.logistics, KEYS.finance, KEYS.dashboard, KEYS.orders];

const AREA_LABEL: Record<ChecklistArea, string> = {
  procurement: 'Procurement',
  deliveries: 'Deliveries',
  load: 'Load (KG)',
  returns: 'Returns & shortages',
  collections: 'Collections',
  handover: 'Money handover',
  expenses: 'Expenses',
};

/** The handover formula, line by line: what the driver should be holding. */
function HandoverLines({ handover }: { handover: HandoverSummary }) {
  const t = useT();
  const currency = useCurrency();
  return (
    <div className="table-wrap">
      <table className="table handover-table">
        <tbody>
          <tr>
            <td>{t('Opening cash (advance)')}</td>
            <td className="num">{formatMoney(handover.openingCash, currency)}</td>
          </tr>
          <tr>
            <td>{t('+ Cash collected from customers')}</td>
            <td className="num">{formatMoney(handover.cashCollections, currency)}</td>
          </tr>
          <tr>
            <td>{t('+ Cash from spot sales')}</td>
            <td className="num">{formatMoney(handover.spotCash, currency)}</td>
          </tr>
          <tr>
            <td>{t('− Expenses paid')}</td>
            <td className="num">{formatMoney(handover.expenses, currency)}</td>
          </tr>
          <tr>
            <td>{t('− Deposited in the bank on the road')}</td>
            <td className="num">{formatMoney(handover.deposited, currency)}</td>
          </tr>
          <tr className="total-row">
            <td>{t('Cash to hand over')}</td>
            <td className="num">{formatMoney(handover.expected, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="checklist">
      {items.map((item) => (
        <li key={item.area} data-status={item.status}>
          <span className="checklist-mark" aria-hidden="true">
            {item.status === 'pass' ? '✓' : '!'}
          </span>
          <span>
            <strong>{AREA_LABEL[item.area]}</strong>
            <span className="checklist-detail">{item.detail}</span>
          </span>
          <StatusBadge
            status={item.status}
            tone={item.status === 'pass' ? 'done' : 'attention'}
            label={item.status === 'pass' ? 'Pass' : 'Exception'}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The owner's side of a submitted trip: what the driver should hand over,
 * each area checked, and close / hold / return to the driver.
 */
export function TripClosure({ trip, deposits }: { trip: TripRecord; deposits: TripCashDepositRecord[] }) {
  const t = useT();
  const currency = useCurrency();
  const review = useTripReview(trip.id, true);
  const [open, setOpen] = useState<'close' | 'hold' | 'return' | null>(null);

  if (review.isPending) return <SkeletonLines lines={5} />;
  if (review.error) return <ErrorState error={review.error} onRetry={() => review.refetch()} />;
  const { handover, checklist, load, pendingSpotSales } = review.data;

  return (
    <section className="closure" aria-label={t('Reconcile and close')}>
      <div className="closure-head">
        <h3 className="detail-subhead">{t('Reconcile and close')}</h3>
        {trip.status === 'on_hold' && <StatusBadge status="on_hold" />}
      </div>
      {trip.status === 'on_hold' && trip.reviewNote && <p className="action-note">{t('On hold:')} {trip.reviewNote}</p>}
      {trip.submitNote && <p className="action-note" data-tone="info">{t("Driver's note:")} {trip.submitNote}</p>}

      <HandoverLines handover={handover} />
      <KeyValues
        items={[
          ['Driver says they’re handing over', handover.declared === null ? 'Not stated' : formatMoney(handover.declared, currency)],
          ['Paid straight to you (UPI / bank / cheque)', formatMoney(handover.directPayments, currency)],
        ]}
      />
      {deposits.length > 0 && (
        <p className="muted">
          {t('Bank deposits:')}{' '}
          {deposits.map((d) => `${formatMoney(d.amount, currency)} into ${d.bankAccount} (ref ${d.reference})`).join('; ')}
        </p>
      )}

      <h3 className="detail-subhead">{t('Checks')}</h3>
      <Checklist items={checklist} />

      {load.length > 0 && (
        <>
          <h3 className="detail-subhead">{t('What the vehicle carried')}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th className="align-right">{t('Picked up')}</th>
                  <th className="align-right">{t('Delivered')}</th>
                  <th className="align-right">{t('Came back')}</th>
                </tr>
              </thead>
              <tbody>
                {load.map((l) => (
                  <tr key={l.product}>
                    <td>{l.product}</td>
                    <td className="num">{`${Number(l.pickedUp)} ${l.uom}`}</td>
                    <td className="num">{`${Number(l.delivered)} ${l.uom}`}</td>
                    <td className="num" data-tone={Number(l.returned) > 0 ? 'attention' : undefined}>{`${Number(l.returned)} ${l.uom}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pendingSpotSales > 0 && (
        <p className="action-note">
          {pendingSpotSales} spot sale(s) on this trip still need your decision under Spot sales before it can close.
        </p>
      )}

      <ActionBar>
        <button type="button" className="button button-primary" disabled={pendingSpotSales > 0} onClick={() => setOpen('close')}>
          Count cash & close
        </button>
        {trip.status === 'completed' && (
          <button type="button" className="button" onClick={() => setOpen('hold')}>
            {t('Put on hold')}
          </button>
        )}
        <button type="button" className="button" onClick={() => setOpen('return')}>
          {t('Return to driver')}
        </button>
      </ActionBar>

      {open === 'close' && <CloseDialog trip={trip} handover={handover} checklist={checklist} onClose={() => setOpen(null)} />}
      {open === 'hold' && (
        <DecisionDialog
          trip={trip}
          step="hold"
          title={t('Put this trip on hold?')}
          description={t("It stays out of the books until you close it. Say what you're checking.")}
          label={t('Put on hold')}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'return' && (
        <DecisionDialog
          trip={trip}
          step="return"
          title={t('Return this trip to the driver?')}
          description={t('The driver sees your note, corrects the trip in the app and submits it again.')}
          label={t('Return to driver')}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function CloseDialog({
  trip,
  handover,
  checklist,
  onClose,
}: {
  trip: TripRecord;
  handover: HandoverSummary;
  checklist: ChecklistItem[];
  onClose: () => void;
}) {
  const t = useT();
  const currency = useCurrency();
  const [received, setReceived] = useState(handover.declared ?? (Number(handover.expected) > 0 ? handover.expected : '0.00'));
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const close = useAction((body: ReconcileTripBody) => apiSend('POST', `logistics/trips/${trip.id}/reconcile`, body), EFFECTS, onClose);

  const parsed = parseMoney(received, 'the cash received');
  // Display-only: the backend checks again and stores the result.
  const variance = parsed.ok ? sumMoney([handover.expected, `-${parsed.value.toFixed(2)}`]) : null;
  const handoverOk = variance !== null && Number(variance) === 0;
  const otherExceptions = checklist.filter((c) => c.status === 'exception' && c.area !== 'handover');
  const needsReason = !handoverOk || otherExceptions.length > 0;

  return (
    <FormDialog
      title={t('Count the cash and close the trip')}
      description={
        <p>
          {t('The driver should hand over')} <strong>{formatMoney(handover.expected, currency)}</strong>.
          {otherExceptions.length > 0 && ` ${otherExceptions.length} other check(s) need your approval.`}
        </p>
      }
      submitLabel={needsReason ? 'Approve with exception & close' : 'Close trip'}
      pending={close.isPending}
      error={problem ?? close.error}
      onClose={onClose}
      onSubmit={() => {
        const error = firstError([parsed]);
        if (error) return setProblem(error);
        if (needsReason && reason.trim().length < 3) return setProblem(t('Say why you are approving it with an exception.'));
        setProblem(null);
        close.mutate({
          version: trip.version,
          cashReturned: (parsed as { value: number }).value,
          notes: optionalText(notes),
          exceptionNote: needsReason ? reason.trim() : undefined,
        });
      }}
    >
      <Field
        label={`Cash received (${currency})`}
        hint={
          variance === null
            ? undefined
            : Number(variance) === 0
              ? 'Matches what the driver should hand over'
              : Number(variance) > 0
                ? `${formatMoney(variance, currency)} short`
                : `${formatMoney(variance.replace('-', ''), currency)} over`
        }
      >
        {(props) => <input {...props} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} />}
      </Field>
      {needsReason && (
        <Field label={t('Reason for approving with an exception')} hint={t('Kept with the trip for the audit trail')}>
          {(props) => <textarea {...props} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
      <Field label={t('Notes (optional)')}>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function DecisionDialog({
  trip,
  step,
  title,
  description,
  label,
  onClose,
}: {
  trip: TripRecord;
  step: 'hold' | 'return';
  title: string;
  description: string;
  label: string;
  onClose: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const decide = useAction((body: TripDecisionBody) => apiSend('POST', `logistics/trips/${trip.id}/${step}`, body), EFFECTS, onClose);
  return (
    <FormDialog
      title={title}
      description={<p>{description}</p>}
      submitLabel={label}
      pending={decide.isPending}
      error={problem ?? decide.error}
      onClose={onClose}
      onSubmit={() => {
        if (note.trim().length < 3) return setProblem(t('Write a short note.'));
        setProblem(null);
        decide.mutate({ version: trip.version, note: note.trim() });
      }}
    >
      <Field label={step === 'hold' ? 'What are you checking?' : 'What should the driver correct?'}>
        {(props) => <textarea {...props} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

/** A closed trip: how it closed, the handover and what was checked. */
export function ClosedTrip({ reconciliation, timeZone }: { reconciliation: TripReconciliationRecord; timeZone: string }) {
  const t = useT();
  const currency = useCurrency();
  const variance = Number(reconciliation.variance);
  return (
    <>
      <KeyValues
        items={[
          [
            'Closed',
            reconciliation.outcome === 'approved_exception' ? (
              <StatusBadge status="approved_exception" tone="attention" label={t('Approved with exception')} />
            ) : (
              <StatusBadge status="pass" tone="done" label={t('All checks passed')} />
            ),
          ],
          ['Advance', formatMoney(reconciliation.advanceAmount, currency)],
          ['Cash collected', formatMoney(reconciliation.cashCollections, currency)],
          ['Spot-sale cash', formatMoney(reconciliation.spotCash, currency)],
          ['Expenses', formatMoney(reconciliation.totalExpenses, currency)],
          ['Deposited in bank', formatMoney(reconciliation.cashDeposited, currency)],
          ['Cash received', formatMoney(reconciliation.cashReturned, currency)],
          [
            'Variance',
            variance === 0 ? (
              <StatusBadge status="balanced" tone="done" label={t('Balanced')} />
            ) : (
              <StatusBadge
                status="short"
                tone="bad"
                label={`${formatMoney(reconciliation.variance.replace('-', ''), currency)} ${variance > 0 ? 'short' : 'over'}`}
              />
            ),
          ],
          ['Closed on', formatDateTime(reconciliation.reconciledAt, timeZone)],
        ]}
      />
      {reconciliation.exceptionNote && <p className="action-note">{t('Approved because:')} {reconciliation.exceptionNote}</p>}
      {reconciliation.notes && <p className="muted">{reconciliation.notes}</p>}
      {reconciliation.checklist && <Checklist items={reconciliation.checklist} />}
    </>
  );
}
