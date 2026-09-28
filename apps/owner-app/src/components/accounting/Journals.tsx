'use client';

import { Fragment, useState } from 'react';
import type { AccountRecord, CreateJournalBody, JournalEntry } from '@morbeez/shared-types';
import { Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Pager } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { entryLabel, ROOT_LABEL } from '@/lib/accounting';
import { formatAmount, formatDate } from '@/lib/format';
import { parseMoney } from '@/lib/parse';
import { sumMoney } from '@/lib/decimal';

interface DraftLine {
  key: number;
  accountCode: string;
  debit: string;
  credit: string;
}

const dayAfter = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, accountCode: '', debit: '', credit: '' });

/**
 * A manual journal: opening balances, rent, salaries, capital, drawings,
 * depreciation, corrections. Control accounts (receivables, payables,
 * stock, advances) aren't offered — their own records keep them.
 */
export function NewJournalDialog({
  accounts,
  today,
  lockedThrough,
  onClose,
}: {
  accounts: AccountRecord[];
  today: string;
  lockedThrough: string | null;
  onClose: () => void;
}) {
  const usable = accounts.filter((a) => a.isActive && !a.isControl);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine(), blankLine()]);
  const [problem, setProblem] = useState<string | null>(null);
  const post = useAction(
    (body: CreateJournalBody) => apiSend<JournalEntry>('POST', 'accounting/journal-entries', body),
    [KEYS.accounting, KEYS.dashboard],
    onClose,
  );

  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // Display-only running totals of what's been typed so far.
  const clean = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '').trim()) ? v.replace(/,/g, '').trim() : '0');
  const debits = sumMoney(lines.map((l) => clean(l.debit)));
  const credits = sumMoney(lines.map((l) => clean(l.credit)));
  const difference = sumMoney([debits, `-${credits}`]);

  const submit = () => {
    if (memo.trim().length < 3) return setProblem('Say what this journal is for (at least 3 characters).');
    if (lockedThrough && date <= lockedThrough) {
      return setProblem(`The books are closed through ${formatDate(lockedThrough)} — date it after that.`);
    }
    const body: CreateJournalBody['lines'] = [];
    for (const [i, line] of lines.entries()) {
      const n = i + 1;
      const hasDebit = line.debit.trim() !== '';
      const hasCredit = line.credit.trim() !== '';
      if (!line.accountCode && !hasDebit && !hasCredit) continue; // an untouched spare line
      if (!line.accountCode) return setProblem(`Choose the account on line ${n}.`);
      if (hasDebit === hasCredit) return setProblem(`Line ${n} needs an amount in exactly one column — debit or credit.`);
      const amount = parseMoney(hasDebit ? line.debit : line.credit, `the amount on line ${n}`, true);
      if (!amount.ok) return setProblem(amount.error);
      body.push(hasDebit ? { accountCode: line.accountCode, debit: amount.value } : { accountCode: line.accountCode, credit: amount.value });
    }
    if (body.length < 2) return setProblem('A journal needs at least two lines.');
    if (Number(difference) !== 0) return setProblem(`Debits and credits differ by ${formatAmount(difference.replace('-', ''))}.`);
    setProblem(null);
    post.mutate({ date, memo: memo.trim(), reference: reference.trim() || undefined, lines: body });
  };

  return (
    <FormDialog
      title="New journal entry"
      description={<p>Every journal balances: total debits equal total credits.</p>}
      submitLabel="Post journal"
      size="wide"
      pending={post.isPending}
      error={problem ?? post.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Date">
        {(props) => (
          <input
            {...props}
            type="date"
            value={date}
            max={today}
            min={lockedThrough ? dayAfter(lockedThrough) : undefined}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
      </Field>
      <Field label="Reference (optional)" hint="Bill or voucher number">
        {(props) => <input {...props} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />}
      </Field>
      <Field label="What it's for" wide>
        {(props) => <input {...props} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />}
      </Field>
      <div className="lines-editor journal-lines" role="group" aria-label="Journal lines">
        <div className="lines-editor-head" aria-hidden="true">
          <span>Account</span>
          <span>Debit</span>
          <span>Credit</span>
          <span />
        </div>
        {lines.map((line, i) => (
          <div className="line-row" key={line.key}>
            <select
              aria-label={`Line ${i + 1} account`}
              value={line.accountCode}
              onChange={(e) => update(line.key, { accountCode: e.target.value })}
            >
              <option value="">Choose an account…</option>
              {(Object.keys(ROOT_LABEL) as (keyof typeof ROOT_LABEL)[]).map((root) => (
                <optgroup key={root} label={ROOT_LABEL[root]}>
                  {usable
                    .filter((a) => a.rootType === root)
                    .map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.number} · {a.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <input
              aria-label={`Line ${i + 1} debit`}
              inputMode="decimal"
              placeholder="Debit"
              value={line.debit}
              onChange={(e) => update(line.key, { debit: e.target.value })}
            />
            <input
              aria-label={`Line ${i + 1} credit`}
              inputMode="decimal"
              placeholder="Credit"
              value={line.credit}
              onChange={(e) => update(line.key, { credit: e.target.value })}
            />
            <button
              type="button"
              className="button button-small"
              aria-label={`Remove line ${i + 1}`}
              disabled={lines.length <= 2}
              onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="lines-total">
          <button type="button" className="button button-small" onClick={() => setLines([...lines, blankLine()])}>
            Add a line
          </button>
          <span aria-live="polite">
            Debits {formatAmount(debits)} · Credits {formatAmount(credits)}
            {Number(difference) !== 0 && (
              <strong data-tone="bad"> · off by {formatAmount(difference.replace('-', ''))}</strong>
            )}
          </span>
        </div>
      </div>
    </FormDialog>
  );
}

function ReverseDialog({ entry, today, onClose }: { entry: JournalEntry; today: string; onClose: () => void }) {
  const [date, setDate] = useState(today);
  const reverse = useAction(
    () => apiSend<JournalEntry>('POST', `accounting/journal-entries/${entry.id}/reverse`, { date }),
    [KEYS.accounting, KEYS.dashboard],
    onClose,
  );
  return (
    <FormDialog
      title={`Reverse journal #${entry.journalNumber}?`}
      description={
        <p>
          Posts a new entry with every line on the other side, cancelling “{entry.memo}”. The original stays on the books,
          marked as reversed.
        </p>
      }
      submitLabel="Reverse"
      tone="danger"
      pending={reverse.isPending}
      error={reverse.error}
      onClose={onClose}
      onSubmit={() => reverse.mutate(undefined)}
    >
      <Field label="Reversal date">
        {(props) => <input {...props} type="date" value={date} min={entry.date} max={today} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

export function JournalsTable({
  entries,
  page,
  pageSize,
  total,
  onPage,
  canPost,
  today,
}: {
  entries: JournalEntry[];
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  canPost: boolean;
  today: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Entry</th>
              <th scope="col">Details</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && <EmptyRow colSpan={5}>No entries in this period.</EmptyRow>}
            {entries.map((entry) => {
              const expanded = open.has(entry.id);
              return (
                <Fragment key={entry.id}>
                  <tr>
                    <td>{formatDate(entry.date)}</td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={expanded}
                        aria-controls={`lines-${entry.id}`}
                        onClick={() => toggle(entry.id)}
                      >
                        {expanded ? '▾' : '▸'} {entryLabel(entry.entryType)}
                        {entry.journalNumber !== null && ` #${entry.journalNumber}`}
                      </button>
                      {entry.reversedByEntryId && (
                        <>
                          {' '}
                          <StatusBadge status="reversed" tone="muted" label="Reversed" />
                        </>
                      )}
                    </td>
                    <td className="muted">
                      {[entry.reference, entry.memo].filter(Boolean).join(' · ')}
                    </td>
                    <td className="num">{formatAmount(entry.total)}</td>
                    <td>
                      {canPost && entry.entryType === 'manual_journal' && !entry.reversedByEntryId && (
                        <button type="button" className="button button-small" onClick={() => setReversing(entry)}>
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={`lines-${entry.id}`} className="journal-detail">
                      <td colSpan={5}>
                        <table className="table statement nested">
                          <thead>
                            <tr>
                              <th scope="col">Account</th>
                              <th scope="col">Party</th>
                              <th scope="col" className="num">
                                Debit
                              </th>
                              <th scope="col" className="num">
                                Credit
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.lines.map((l, i) => (
                              <tr key={i}>
                                <td className={Number(l.credit) > 0 ? 'st-credit' : undefined}>
                                  <span className="st-number">{l.accountNumber}</span> {l.accountName}
                                </td>
                                <td className="muted">{l.partyName ?? ''}</td>
                                <td className="num">{Number(l.debit) === 0 ? '' : formatAmount(l.debit)}</td>
                                <td className="num">{Number(l.credit) === 0 ? '' : formatAmount(l.credit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="footnote">
                          Posted by {entry.createdByEmail ?? 'the system'}
                          {entry.reversesEntryId && ' · reverses an earlier entry'}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={pageSize} total={total} onPage={onPage} />
      {reversing && <ReverseDialog entry={reversing} today={today} onClose={() => setReversing(null)} />}
    </>
  );
}
