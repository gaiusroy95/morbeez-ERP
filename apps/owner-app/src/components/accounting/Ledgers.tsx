'use client';

import { useId } from 'react';
import type { AccountingTrialBalance, AccountRecord, GeneralLedger } from '@morbeez/shared-types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { entryLabel, ROOT_LABEL } from '@/lib/accounting';
import { formatAmount, formatDate } from '@/lib/format';

export function TrialBalanceView({ tb, onOpen }: { tb: AccountingTrialBalance; onOpen: (code: string) => void }) {
  return (
    <div className="stack">
      <p className="st-status">
        {tb.balanced ? (
          <StatusBadge status="balanced" tone="done" label="Debits equal credits" />
        ) : (
          <StatusBadge status="unbalanced" tone="bad" label="Out of balance — report this" />
        )}{' '}
        <span className="muted">
          As of {formatDate(tb.asOf)} · amounts in {tb.currency} · accounts with a balance
        </span>
      </p>
      <div className="table-wrap">
        <table className="table statement">
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Account</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">
                Debit
              </th>
              <th scope="col" className="num">
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {tb.lines.length === 0 && <EmptyRow colSpan={5}>Nothing posted yet.</EmptyRow>}
            {tb.lines.map((line) => (
              <tr key={line.code}>
                <td className="st-number">{line.number}</td>
                <th scope="row" className="st-account">
                  <button type="button" className="link-button" onClick={() => onOpen(line.code)}>
                    {line.name}
                  </button>
                </th>
                <td className="muted">{ROOT_LABEL[line.rootType]}</td>
                <td className="num">{Number(line.debit) === 0 ? '' : formatAmount(line.debit)}</td>
                <td className="num">{Number(line.credit) === 0 ? '' : formatAmount(line.credit)}</td>
              </tr>
            ))}
            <tr className="st-total">
              <th scope="row" colSpan={3}>
                Totals
              </th>
              <td className="num">{formatAmount(tb.totals.debit)}</td>
              <td className="num">{formatAmount(tb.totals.credit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AccountPicker({
  accounts,
  value,
  onChange,
  label = 'Account',
}: {
  accounts: AccountRecord[];
  value: string | null;
  onChange: (code: string) => void;
  label?: string;
}) {
  const id = useId();
  const groups = (Object.keys(ROOT_LABEL) as (keyof typeof ROOT_LABEL)[]).map((root) => ({
    root,
    accounts: accounts.filter((a) => a.rootType === root),
  }));
  return (
    <div className="range-controls">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
        <option value="">Choose an account…</option>
        {groups.map((g) => (
          <optgroup key={g.root} label={ROOT_LABEL[g.root]}>
            {g.accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.number} · {a.name}
                {a.isActive ? '' : ' (retired)'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export function GeneralLedgerView({ ledger }: { ledger: GeneralLedger }) {
  const side = ledger.account.normalSide === 'debit' ? 'debit' : 'credit';
  return (
    <div className="stack">
      <p className="st-status muted">
        {ledger.account.number} · {ledger.account.name} · {formatDate(ledger.from)} – {formatDate(ledger.to)} · amounts
        in {ledger.currency} · balance shown as a {side} balance
      </p>
      <div className="table-wrap">
        <table className="table statement">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Entry</th>
              <th scope="col">Details</th>
              <th scope="col" className="num">
                Debit
              </th>
              <th scope="col" className="num">
                Credit
              </th>
              <th scope="col" className="num">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="st-subtotal">
              <th scope="row" colSpan={5}>
                Opening balance
              </th>
              <td className="num">{formatAmount(ledger.opening)}</td>
            </tr>
            {ledger.lines.length === 0 && <EmptyRow colSpan={6}>No movements in this period.</EmptyRow>}
            {ledger.lines.map((line, i) => (
              <tr key={`${line.entryId}-${i}`}>
                <td>{formatDate(line.date)}</td>
                <td>
                  {entryLabel(line.entryType)}
                  {line.journalNumber !== null && <span className="muted"> #{line.journalNumber}</span>}
                </td>
                <td className="muted">{[line.partyName, line.memo].filter(Boolean).join(' · ')}</td>
                <td className="num">{Number(line.debit) === 0 ? '' : formatAmount(line.debit)}</td>
                <td className="num">{Number(line.credit) === 0 ? '' : formatAmount(line.credit)}</td>
                <td className="num">{formatAmount(line.balance)}</td>
              </tr>
            ))}
            <tr className="st-total">
              <th scope="row" colSpan={3}>
                Closing balance
              </th>
              <td className="num">{formatAmount(ledger.totals.debit)}</td>
              <td className="num">{formatAmount(ledger.totals.credit)}</td>
              <td className="num">{formatAmount(ledger.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {ledger.truncated && (
        <p className="footnote">Showing the first 2,000 lines — narrow the dates to see the rest. Totals cover the whole period.</p>
      )}
    </div>
  );
}
