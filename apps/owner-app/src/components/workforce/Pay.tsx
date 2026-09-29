'use client';

import { Fragment, useState } from 'react';
import type { AdvanceRecord, EarningsPreview, SettlementLine, SettlementRecord, WorkerRow } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, FilterTabs, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useSettlement } from '@/lib/hooks/use-workforce';
import { formatAmount, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { parseMoney } from '@/lib/parse';
import { sumMoney } from '@/lib/decimal';
import type { DateRange } from '@/lib/hooks/use-accounting';

const LINE_LABEL: Record<SettlementLine['kind'], string> = {
  basic: 'Pay',
  incentive: 'Incentive',
  minimum_wage_topup: 'Minimum-wage top-up',
  adjustment: 'Adjustment',
  advance_recovery: 'Advance recovered',
};

function Lines({ lines }: { lines: SettlementLine[] }) {
  return (
    <table className="table statement nested">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>
              <span className="muted">{LINE_LABEL[l.kind]}</span> · {l.description}
            </td>
            <td className="num" data-tone={Number(l.amount) < 0 ? 'bad' : undefined}>
              {formatAmount(l.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Pay run ----

export function PayRunView({
  rows,
  range,
  currency,
  canPrepare,
  onDrafted,
}: {
  rows: EarningsPreview[];
  range: DateRange;
  currency: string;
  canPrepare: boolean;
  onDrafted: () => void;
}) {
  const payable = rows.filter((r) => !r.blockedBy && Number(r.gross) > 0);
  // Who's been unticked, not who's ticked: rows that arrive later (a new
  // period loading) are included by default.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<EarningsPreview | null>(null);
  const draft = useAction(
    (body: unknown) => apiSend('POST', 'workforce/settlements', body),
    [KEYS.workforce],
    onDrafted,
  );
  const chosen = payable.filter((r) => !excluded.has(r.employeeId));
  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcluded(next);
  };
  return (
    <>
      <Figures
        items={[
          { label: 'Gross pay', value: formatMoney(sumMoney(payable.map((r) => r.gross)), currency) },
          { label: 'Deductions', value: formatMoney(sumMoney(payable.map((r) => r.deductions)), currency) },
          { label: 'Net to pay', value: formatMoney(sumMoney(payable.map((r) => r.net)), currency) },
          { label: 'Warnings', value: String(rows.filter((r) => r.warnings.length).length), tone: rows.some((r) => r.warnings.length) ? 'attention' : undefined },
        ]}
      />
      <p className="muted">
        What each worker is owed for {formatDate(range.from)} – {formatDate(range.to)} from their recorded work, pay rates,
        incentives and the minimum wage, less advances. Nothing is saved until you draft settlements; someone else then
        approves them.
      </p>
      {canPrepare && (
        <ActionBar>
          <button
            type="button"
            className="button button-primary"
            disabled={chosen.length === 0 || draft.isPending}
            onClick={() => draft.mutate({ from: range.from, to: range.to, employeeIds: chosen.map((r) => r.employeeId) })}
          >
            {draft.isPending ? 'Drafting…' : `Draft ${chosen.length} settlement(s)`}
          </button>
        </ActionBar>
      )}
      {draft.error ? (
        <p className="form-error" role="alert">
          {(draft.error as Error).message}
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {canPrepare && <th />}
              <th>Worker</th>
              <th className="num">Days</th>
              <th className="num">Gross</th>
              <th className="num">Deductions</th>
              <th className="num">Net</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={7}>No active workers.</EmptyRow>}
            {rows.map((r) => {
              const expanded = open === r.employeeId;
              const ok = !r.blockedBy && Number(r.gross) > 0;
              return (
                <Fragment key={r.employeeId}>
                  <tr>
                    {canPrepare && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include ${r.employeeName}`}
                          disabled={!ok}
                          checked={ok && !excluded.has(r.employeeId)}
                          onChange={() => toggle(r.employeeId)}
                        />
                      </td>
                    )}
                    <td>
                      <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.employeeId)}>
                        {expanded ? '▾' : '▸'} {r.employeeName}
                      </button>
                      {r.blockedBy && <div className="cell-sub">{r.blockedBy}</div>}
                      {!r.blockedBy && r.warnings.length > 0 && (
                        <div className="cell-sub" data-tone="attention">
                          {r.warnings.length} warning(s)
                        </div>
                      )}
                    </td>
                    <td className="num">{r.daysWorked}</td>
                    <td className="num">{formatAmount(r.gross)}</td>
                    <td className="num">{Number(r.deductions) ? formatAmount(r.deductions) : '—'}</td>
                    <td className="num">
                      <strong>{formatAmount(r.net)}</strong>
                    </td>
                    <td>
                      {canPrepare && ok && (
                        <button type="button" className="button button-small" onClick={() => setAdjusting(r)}>
                          Adjust &amp; draft
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="journal-detail">
                      <td colSpan={7}>
                        {r.lines.length ? <Lines lines={r.lines} /> : <p className="muted">Nothing earned in this period.</p>}
                        {r.warnings.map((w) => (
                          <p key={w} className="action-note">
                            {w}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {adjusting && <AdjustDialog preview={adjusting} range={range} currency={currency} onClose={() => setAdjusting(null)} onDrafted={onDrafted} />}
    </>
  );
}

function AdjustDialog({
  preview,
  range,
  currency,
  onClose,
  onDrafted,
}: {
  preview: EarningsPreview;
  range: DateRange;
  currency: string;
  onClose: () => void;
  onDrafted: () => void;
}) {
  const [rows, setRows] = useState([{ description: '', amount: '' }]);
  const [cap, setCap] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const draft = useAction((body: unknown) => apiSend('POST', 'workforce/settlements', body), [KEYS.workforce], () => {
    onClose();
    onDrafted();
  });
  return (
    <FormDialog
      title={`Draft with adjustments — ${preview.employeeName}`}
      description={<p>A bonus or allowance adds to pay; a negative amount (e.g. a recovery for damage) is a deduction.</p>}
      submitLabel="Draft settlement"
      size="wide"
      pending={draft.isPending}
      error={problem ?? draft.error}
      onClose={onClose}
      onSubmit={() => {
        const adjustments: { description: string; amount: number }[] = [];
        for (const [i, r] of rows.entries()) {
          if (!r.description.trim() && !r.amount.trim()) continue;
          if (r.description.trim().length < 3) return setProblem(`Describe adjustment ${i + 1}.`);
          const negative = r.amount.trim().startsWith('-');
          const amount = parseMoney(r.amount.trim().replace(/^-/, ''), `the amount of adjustment ${i + 1}`, true);
          if (!amount.ok) return setProblem(amount.error);
          adjustments.push({ description: r.description.trim(), amount: negative ? -amount.value : amount.value });
        }
        let maxAdvanceRecovery: number | undefined;
        if (cap.trim()) {
          const c = parseMoney(cap, 'the most to recover');
          if (!c.ok) return setProblem(c.error);
          maxAdvanceRecovery = c.value;
        }
        setProblem(null);
        draft.mutate({ from: range.from, to: range.to, employeeIds: [preview.employeeId], adjustments, maxAdvanceRecovery });
      }}
    >
      <div className="form-wide">
        {rows.map((r, i) => (
          <div className="line-row" key={i} style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto' }}>
            <input aria-label={`Adjustment ${i + 1} description`} placeholder="What for" value={r.description} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <input aria-label={`Adjustment ${i + 1} amount`} inputMode="decimal" placeholder={`${currency}, − to deduct`} value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <button type="button" className="button button-small" aria-label={`Remove adjustment ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="button button-small" onClick={() => setRows([...rows, { description: '', amount: '' }])}>
          Add another
        </button>
      </div>
      <Field label={`Most to recover from advances (${currency}, optional)`} hint="Blank recovers as much as the pay allows">
        {(p) => <input {...p} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---- Settlements ----

const STATUS_TONE = { draft: 'attention', approved: 'active', paid: 'done', void: 'muted' } as const;
const STATUS_LABEL = { draft: 'Draft — to approve', approved: 'Approved — to pay', paid: 'Paid', void: 'Void' } as const;

export function SettlementsView({
  rows,
  status,
  onStatus,
  currency,
  selected,
  onSelect,
}: {
  rows: SettlementRecord[];
  status: string;
  onStatus: (s: string) => void;
  currency: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <FilterTabs
        label="Settlement status"
        options={[
          { value: 'all', label: 'All' },
          { value: 'draft', label: 'To approve' },
          { value: 'approved', label: 'To pay' },
          { value: 'paid', label: 'Paid' },
          { value: 'void', label: 'Void' },
        ]}
        value={status}
        onChange={(v) => onStatus(v)}
      />
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Worker</th>
              <th>Period</th>
              <th>Status</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No settlements here.</EmptyRow>}
            {rows.map((s) => (
              <SelectableRow key={s.id} selected={selected === s.id} onSelect={() => onSelect(s.id)} label={`Settlement ${s.settlementNumber}`}>
                <td className="st-number">#{s.settlementNumber}</td>
                <td>
                  {s.employeeName}
                  {s.warnings.length > 0 && s.status === 'draft' && (
                    <div className="cell-sub" data-tone="attention">
                      {s.warnings.length} warning(s)
                    </div>
                  )}
                </td>
                <td>
                  {formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
                </td>
                <td>
                  <StatusBadge status={s.status} tone={STATUS_TONE[s.status]} label={STATUS_LABEL[s.status]} />
                </td>
                <td className="num">{formatMoney(s.net, currency)}</td>
              </SelectableRow>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SettlementPanel({
  id,
  currency,
  timeZone,
  userEmail,
  canApprove,
  canPay,
  onClose,
}: {
  id: string;
  currency: string;
  timeZone: string;
  userEmail: string | null;
  canApprove: boolean;
  canPay: boolean;
  onClose: () => void;
}) {
  const { data: s, error, isPending, refetch } = useSettlement(id);
  const [dialog, setDialog] = useState<'approve' | 'pay' | 'void' | null>(null);
  if (isPending || error || !s) {
    return (
      <DetailPanel title="Settlement" onClose={onClose}>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  const own = s.preparedByEmail !== null && s.preparedByEmail === userEmail;
  return (
    <DetailPanel title={`Settlement #${s.settlementNumber} · ${s.employeeName}`} onClose={onClose}>
      <KeyValues
        items={[
          ['Period', `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`],
          ['Status', <StatusBadge key="s" status={s.status} tone={STATUS_TONE[s.status]} label={STATUS_LABEL[s.status]} />],
          ['Prepared', `${s.preparedByEmail ?? '—'} · ${formatDateTime(s.preparedAt, timeZone)}`],
          ['Approved', s.approvedAt ? `${s.approvedByEmail ?? '—'} · ${formatDateTime(s.approvedAt, timeZone)}` : '—'],
          ['Paid', s.paidAt ? `${formatDateTime(s.paidAt, timeZone)} · ${s.paidFrom === 'bank' ? 'Bank' : 'Cash'}${s.paymentReference ? ` · ${s.paymentReference}` : ''}` : '—'],
        ]}
      />
      {s.voidReason && (
        <p className="action-note" data-tone="bad">
          Voided: {s.voidReason}
        </p>
      )}
      {s.warnings.map((w) => (
        <p key={w} className="action-note">
          {w}
        </p>
      ))}
      <h3 className="detail-subhead">Pay</h3>
      <Lines lines={s.lines ?? []} />
      <Figures
        items={[
          { label: 'Gross', value: formatMoney(s.gross, currency) },
          { label: 'Deductions', value: formatMoney(s.deductions, currency) },
          { label: 'Net', value: formatMoney(s.net, currency) },
        ]}
      />
      <ActionBar>
        {canApprove && s.status === 'draft' && (
          <button
            type="button"
            className="button button-primary"
            disabled={own}
            title={own ? 'You prepared this — someone else has to approve it' : undefined}
            onClick={() => setDialog('approve')}
          >
            Approve
          </button>
        )}
        {canPay && s.status === 'approved' && (
          <button type="button" className="button button-primary" onClick={() => setDialog('pay')}>
            Record payment
          </button>
        )}
        {canApprove && (s.status === 'draft' || s.status === 'approved') && (
          <button type="button" className="button button-danger" onClick={() => setDialog('void')}>
            Void
          </button>
        )}
      </ActionBar>
      {own && s.status === 'draft' && <p className="footnote">You prepared this settlement, so someone else has to approve it.</p>}
      {dialog === 'approve' && <ApproveDialog s={s} currency={currency} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PayDialog s={s} currency={currency} onClose={() => setDialog(null)} />}
      {dialog === 'void' && <VoidDialog s={s} onClose={() => setDialog(null)} />}
    </DetailPanel>
  );
}

function ApproveDialog({ s, currency, onClose }: { s: SettlementRecord; currency: string; onClose: () => void }) {
  const run = useAction(() => apiSend('POST', `workforce/settlements/${s.id}/approve`, { version: s.version }), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`Approve ${formatMoney(s.net, currency)} for ${s.employeeName}?`}
      description={<p>The wage cost is booked in the period worked ({formatDate(s.periodEnd)}), and {formatMoney(s.net, currency)} becomes payable.</p>}
      submitLabel="Approve"
      pending={run.isPending}
      error={run.error}
      onClose={onClose}
      onSubmit={() => run.mutate(undefined)}
    />
  );
}

function PayDialog({ s, currency, onClose }: { s: SettlementRecord; currency: string; onClose: () => void }) {
  const [from, setFrom] = useState<'bank' | 'cash_on_hand'>('bank');
  const [ref, setRef] = useState('');
  const run = useAction(() => apiSend('POST', `workforce/settlements/${s.id}/pay`, { version: s.version, paidFrom: from, reference: ref.trim() || undefined }), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`Pay ${s.employeeName} ${formatMoney(s.net, currency)}`}
      submitLabel="Record payment"
      pending={run.isPending}
      error={run.error}
      onClose={onClose}
      onSubmit={() => run.mutate(undefined)}
    >
      <Field label="Paid from">
        {(p) => (
          <select {...p} value={from} onChange={(e) => setFrom(e.target.value as 'bank' | 'cash_on_hand')}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash</option>
          </select>
        )}
      </Field>
      <Field label="Reference (optional)" hint="UPI or bank transfer reference">{(p) => <input {...p} maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function VoidDialog({ s, onClose }: { s: SettlementRecord; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const run = useAction(() => apiSend('POST', `workforce/settlements/${s.id}/void`, { version: s.version, reason: reason.trim() }), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`Void settlement #${s.settlementNumber}?`}
      description={
        <p>
          {s.status === 'approved' ? 'Its wage cost is reversed on the books. ' : ''}The work it covered is released, so it can be settled again
          correctly.
        </p>
      }
      submitLabel="Void"
      tone="danger"
      pending={run.isPending}
      error={problem ?? run.error}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) return setProblem('Say why.');
        setProblem(null);
        run.mutate(undefined);
      }}
    >
      <Field label="Reason" wide>{(p) => <input {...p} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </FormDialog>
  );
}

// ---- Advances ----

export function AdvancesView({
  rows,
  workers,
  currency,
  today,
  canPrepare,
}: {
  rows: AdvanceRecord[];
  workers: WorkerRow[];
  currency: string;
  today: string;
  canPrepare: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Figures
        items={[{ label: 'Outstanding advances', value: formatMoney(sumMoney(rows.map((r) => r.outstanding)), currency), tone: rows.some((r) => Number(r.outstanding) > 0) ? 'attention' : undefined }]}
      />
      {canPrepare && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Record an advance
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Paid</th>
              <th>Worker</th>
              <th className="num">Amount</th>
              <th className="num">Recovered</th>
              <th className="num">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No advances.</EmptyRow>}
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  {formatDate(a.paidOn)}
                  <div className="cell-sub">
                    {a.paidFrom === 'bank' ? 'Bank' : 'Cash'}
                    {a.notes ? ` · ${a.notes}` : ''}
                  </div>
                </td>
                <td>{a.employeeName}</td>
                <td className="num">{formatAmount(a.amount)}</td>
                <td className="num">{Number(a.recovered) ? formatAmount(a.recovered) : '—'}</td>
                <td className="num">{Number(a.outstanding) ? <strong>{formatAmount(a.outstanding)}</strong> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">Advances are recovered from the next settlements, oldest first, never taking pay below zero.</p>
      {adding && <AdvanceDialog workers={workers.filter((w) => w.status === 'active')} currency={currency} today={today} onClose={() => setAdding(false)} />}
    </>
  );
}

function AdvanceDialog({ workers, currency, today, onClose }: { workers: WorkerRow[]; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({ employeeId: '', amount: '', paidOn: today, paidFrom: 'cash_on_hand', notes: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'workforce/advances', body), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title="Record an advance"
      submitLabel="Record"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!f.employeeId) return setProblem('Choose the worker.');
        const amount = parseMoney(f.amount, 'the amount', true);
        if (!amount.ok) return setProblem(amount.error);
        setProblem(null);
        save.mutate({ employeeId: f.employeeId, amount: amount.value, paidOn: f.paidOn, paidFrom: f.paidFrom, notes: f.notes.trim() || undefined });
      }}
    >
      <Field label="Worker">
        {(p) => (
          <select {...p} value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {workers.map((w) => (
              <option key={w.employeeId} value={w.employeeId}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Amount (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
      <Field label="Paid on">{(p) => <input {...p} type="date" max={today} value={f.paidOn} onChange={(e) => set({ paidOn: e.target.value })} />}</Field>
      <Field label="Paid from">
        {(p) => (
          <select {...p} value={f.paidFrom} onChange={(e) => set({ paidFrom: e.target.value })}>
            <option value="cash_on_hand">Cash</option>
            <option value="bank">Bank</option>
          </select>
        )}
      </Field>
      <Field label="Notes (optional)" wide>{(p) => <input {...p} maxLength={300} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
    </FormDialog>
  );
}
