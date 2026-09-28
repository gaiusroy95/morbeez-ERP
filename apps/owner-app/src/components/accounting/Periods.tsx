'use client';

import { useState } from 'react';
import type { PeriodCloseRecord, PeriodsOverview } from '@morbeez/shared-types';
import { Field, FormDialog, ActionBar } from '@/components/ui/Form';
import { Panel, SkeletonLines, ErrorState } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useClosePreview } from '@/lib/hooks/use-accounting';
import { ROOT_LABEL } from '@/lib/accounting';
import { formatAmount, formatDate, formatDateTime } from '@/lib/format';

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The natural next close: the end of last month, unless that's already closed — then yesterday. */
function suggestedThrough(overview: PeriodsOverview): string {
  const endOfLastMonth = addDays(`${overview.today.slice(0, 8)}01`, -1);
  const yesterday = addDays(overview.today, -1);
  if (!overview.lockedThrough || overview.lockedThrough < endOfLastMonth) return endOfLastMonth;
  return yesterday > overview.lockedThrough ? yesterday : overview.lockedThrough;
}

function ClosePanel({ overview, canClose, timeZone }: { overview: PeriodsOverview; canClose: boolean; timeZone: string }) {
  const [through, setThrough] = useState(() => suggestedThrough(overview));
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState('');
  const preview = useClosePreview(through);
  const close = useAction(
    () => apiSend<PeriodsOverview>('POST', 'accounting/periods/close', { through, notes: notes.trim() || undefined }),
    [KEYS.accounting, KEYS.dashboard],
    () => setConfirming(false),
  );
  const maxDate = addDays(overview.today, -1);
  const minDate = overview.lockedThrough ? addDays(overview.lockedThrough, 1) : undefined;

  return (
    <Panel
      title="Close the books"
      meta={
        overview.lockedThrough ? `closed through ${formatDate(overview.lockedThrough)}` : 'no period closed yet'
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Closing moves the period&apos;s profit or loss into retained earnings and locks every date up to it: no payment,
        delivery, grading or journal can be dated on or before it afterwards.
      </p>
      <div className="range-controls">
        <label htmlFor="close-through">Close through</label>
        <input
          id="close-through"
          type="date"
          value={through}
          min={minDate}
          max={maxDate}
          onChange={(e) => e.target.value && setThrough(e.target.value)}
        />
      </div>
      {preview.isPending ? (
        <SkeletonLines lines={3} />
      ) : preview.error ? (
        <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
      ) : (
        <>
          {preview.data.blockers.map((b) => (
            <p key={b} className="action-note" data-tone="bad">
              {b}
            </p>
          ))}
          {preview.data.blockers.length === 0 && (
            <>
              <p className="st-status">
                Period {preview.data.periodStart ? formatDate(preview.data.periodStart) : 'from the start of the books'} –{' '}
                {formatDate(preview.data.periodEnd)}:{' '}
                <strong data-tone={Number(preview.data.netIncome) < 0 ? 'bad' : undefined}>
                  {Number(preview.data.netIncome) < 0 ? 'loss' : 'profit'} of {preview.data.currency}{' '}
                  {formatAmount(preview.data.netIncome.replace('-', ''))}
                </strong>{' '}
                moves to retained earnings.
              </p>
              {preview.data.lines.length > 0 && (
                <div className="table-wrap">
                  <table className="table statement">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Type</th>
                        <th scope="col" className="num">
                          Period total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.lines.map((l) => (
                        <tr key={l.code}>
                          <td>
                            <span className="st-number">{l.number}</span> {l.name}
                          </td>
                          <td className="muted">{ROOT_LABEL[l.rootType]}</td>
                          <td className="num">{formatAmount(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.data.warnings.map((w) => (
                <p key={w} className="action-note">
                  {w}
                </p>
              ))}
              {canClose && (
                <ActionBar>
                  <button type="button" className="button button-primary" onClick={() => setConfirming(true)}>
                    Close through {formatDate(through)}
                  </button>
                </ActionBar>
              )}
            </>
          )}
        </>
      )}
      {confirming && preview.data && (
        <FormDialog
          title={`Close the books through ${formatDate(through)}?`}
          description={
            <>
              <p>
                Nothing can be posted dated on or before {formatDate(through)} after this — including backdated payments.
                The most recent close can be reopened if something was missed.
              </p>
              {preview.data.warnings.length > 0 && <p>There are {preview.data.warnings.length} warning(s) above.</p>}
            </>
          }
          submitLabel="Close the period"
          pending={close.isPending}
          error={close.error}
          onClose={() => setConfirming(false)}
          onSubmit={() => close.mutate(undefined)}
        >
          <Field label="Notes (optional)" wide>
            {(props) => <input {...props} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </FormDialog>
      )}
      <p className="footnote">
        Dates are in the business&apos;s own timezone ({timeZone}).
      </p>
    </Panel>
  );
}

function ReopenDialog({ close, onClose }: { close: PeriodCloseRecord; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reopen = useAction(
    () => apiSend<PeriodsOverview>('POST', `accounting/periods/${close.id}/reopen`, { reason: reason.trim() }),
    [KEYS.accounting, KEYS.dashboard],
    onClose,
  );
  return (
    <FormDialog
      title={`Reopen the period ending ${formatDate(close.periodEnd)}?`}
      description={
        <p>
          The closing entry is reversed and the lock moves back to the close before it. Close it again once the missing
          entries are in.
        </p>
      }
      submitLabel="Reopen"
      tone="danger"
      pending={reopen.isPending}
      error={problem ?? reopen.error}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) return setProblem('Say why it needs reopening.');
        setProblem(null);
        reopen.mutate(undefined);
      }}
    >
      <Field label="Reason" wide>
        {(props) => <input {...props} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

export function PeriodsView({
  overview,
  canClose,
  timeZone,
}: {
  overview: PeriodsOverview;
  canClose: boolean;
  timeZone: string;
}) {
  const [reopening, setReopening] = useState<PeriodCloseRecord | null>(null);
  const latestLive = overview.closes.find((c) => !c.reopenedAt);
  return (
    <div className="stack">
      <ClosePanel key={overview.lockedThrough ?? 'open'} overview={overview} canClose={canClose} timeZone={timeZone} />
      <Panel title="Closes">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className="num">
                  Profit / (loss)
                </th>
                <th scope="col">Closed</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {overview.closes.length === 0 && <EmptyRow colSpan={5}>No period has been closed yet.</EmptyRow>}
              {overview.closes.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.periodStart ? formatDate(c.periodStart) : 'Start of books'} – {formatDate(c.periodEnd)}
                    {c.notes && <div className="cell-sub">{c.notes}</div>}
                  </td>
                  <td className="num" data-tone={Number(c.netIncome) < 0 ? 'bad' : undefined}>
                    {formatAmount(c.netIncome)}
                  </td>
                  <td>
                    {formatDateTime(c.closedAt, timeZone)}
                    <div className="cell-sub">{c.closedByEmail}</div>
                  </td>
                  <td>
                    {c.reopenedAt ? (
                      <>
                        <StatusBadge status="reopened" tone="muted" label="Reopened" />
                        <div className="cell-sub">
                          {formatDateTime(c.reopenedAt, timeZone)} · {c.reopenReason}
                        </div>
                      </>
                    ) : (
                      <StatusBadge status="closed" tone="done" label="Closed" />
                    )}
                  </td>
                  <td>
                    {canClose && c.id === latestLive?.id && (
                      <button type="button" className="button button-small" onClick={() => setReopening(c)}>
                        Reopen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {reopening && <ReopenDialog close={reopening} onClose={() => setReopening(null)} />}
    </div>
  );
}
