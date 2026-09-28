'use client';

import { useState } from 'react';
import type { AccountRecord, CreateAccountBody, ReportGroup, RootType, UpdateAccountBody } from '@morbeez/shared-types';
import { Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { GROUP_LABEL, GROUPS_BY_ROOT, ROOT_LABEL } from '@/lib/accounting';
import { formatAmount } from '@/lib/format';
import { parseWholeNumber } from '@/lib/parse';

// Numbering convention the template follows, suggested for new accounts.
const NUMBER_HINT: Record<RootType, string> = {
  asset: '1000–1999',
  liability: '2000–2999',
  equity: '3000–3999',
  revenue: '4000–4999',
  expense: '5000–7999',
};

// The group a new account of each type most often belongs to.
const DEFAULT_GROUP: Record<RootType, ReportGroup> = {
  asset: 'current_asset',
  liability: 'current_liability',
  equity: 'equity',
  revenue: 'other_income',
  expense: 'operating_expense',
};

export function AccountDialog({ account, onClose }: { account: AccountRecord | null; onClose: () => void }) {
  const editing = account !== null;
  const [rootType, setRootType] = useState<RootType>(account?.rootType ?? 'expense');
  const [reportGroup, setReportGroup] = useState<ReportGroup>(account?.reportGroup ?? 'operating_expense');
  const [number, setNumber] = useState(account ? String(account.number) : '');
  const [name, setName] = useState(account?.name ?? '');
  const [description, setDescription] = useState(account?.description ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: CreateAccountBody | UpdateAccountBody) =>
      editing
        ? apiSend<AccountRecord>('PATCH', `accounting/accounts/${account.code}`, body)
        : apiSend<AccountRecord>('POST', 'accounting/accounts', body),
    [KEYS.accounting],
    onClose,
  );

  const submit = () => {
    const parsed = parseWholeNumber(number, 'the account number', 1, 99999);
    if (!parsed.ok) return setProblem(parsed.error);
    if (name.trim().length < 2) return setProblem('Give the account a name (at least 2 characters).');
    setProblem(null);
    if (editing) {
      save.mutate({ version: account.version, number: parsed.value, name: name.trim(), description });
    } else {
      save.mutate({ number: parsed.value, name: name.trim(), rootType, reportGroup, description: description.trim() || undefined });
    }
  };

  return (
    <FormDialog
      title={editing ? `Edit ${account.name}` : 'New account'}
      description={
        editing ? (
          <p>An account&apos;s type and group can&apos;t change once it exists — its history would move between statements.</p>
        ) : (
          <p>The type and group decide where it appears on the P&amp;L, the balance sheet, and the cash-flow statement.</p>
        )
      }
      submitLabel={editing ? 'Save' : 'Add account'}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={submit}
    >
      {!editing && (
        <>
          <Field label="Type">
            {(props) => (
              <select
                {...props}
                value={rootType}
                onChange={(e) => {
                  const root = e.target.value as RootType;
                  setRootType(root);
                  setReportGroup(DEFAULT_GROUP[root]);
                }}
              >
                {(Object.keys(ROOT_LABEL) as RootType[]).map((r) => (
                  <option key={r} value={r}>
                    {ROOT_LABEL[r]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Group">
            {(props) => (
              <select {...props} value={reportGroup} onChange={(e) => setReportGroup(e.target.value as ReportGroup)}>
                {GROUPS_BY_ROOT[rootType].map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <Field label="Number" hint={`Usually ${NUMBER_HINT[editing ? account.rootType : rootType]}`}>
        {(props) => <input {...props} inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />}
      </Field>
      <Field label="Name">
        {(props) => <input {...props} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Description (optional)" wide>
        {(props) => <input {...props} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function RetireDialog({ account, onClose }: { account: AccountRecord; onClose: () => void }) {
  const retiring = account.isActive;
  const run = useAction(
    () => apiSend<AccountRecord>('PATCH', `accounting/accounts/${account.code}`, { version: account.version, isActive: !retiring }),
    [KEYS.accounting],
    onClose,
  );
  return (
    <FormDialog
      title={retiring ? `Retire ${account.name}?` : `Bring back ${account.name}?`}
      description={
        <p>
          {retiring
            ? 'It stops appearing when posting journals. Its history stays on the books. An account with a balance has to be emptied first.'
            : 'It can be posted to again.'}
        </p>
      }
      submitLabel={retiring ? 'Retire' : 'Bring back'}
      tone={retiring ? 'danger' : undefined}
      pending={run.isPending}
      error={run.error}
      onClose={onClose}
      onSubmit={() => run.mutate(undefined)}
    />
  );
}

export function ChartOfAccountsTable({
  accounts,
  currency,
  canManage,
  onOpen,
}: {
  accounts: AccountRecord[];
  currency: string;
  canManage: boolean;
  onOpen: (code: string) => void;
}) {
  const [editing, setEditing] = useState<AccountRecord | null>(null);
  const [retiring, setRetiring] = useState<AccountRecord | null>(null);
  return (
    <>
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">Balances today, in {currency}, on each account&apos;s normal side</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Account</th>
              <th scope="col">Group</th>
              <th scope="col" className="num">
                Balance
              </th>
              {canManage && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ROOT_LABEL) as RootType[]).map((root) => {
              const rows = accounts.filter((a) => a.rootType === root);
              if (rows.length === 0) return null;
              return (
                <RootRows key={root} root={root} rows={rows} canManage={canManage} onOpen={onOpen} onEdit={setEditing} onRetire={setRetiring} />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        <strong>System</strong> accounts are posted to automatically (sales, stock, payments, trip cash) — they can be
        renamed but not retired. <strong>Control</strong> accounts are kept by their own records (invoices, payables,
        lots, advances) and take no manual journals.
      </p>
      {editing && <AccountDialog account={editing} onClose={() => setEditing(null)} />}
      {retiring && <RetireDialog account={retiring} onClose={() => setRetiring(null)} />}
    </>
  );
}

function RootRows({
  root,
  rows,
  canManage,
  onOpen,
  onEdit,
  onRetire,
}: {
  root: RootType;
  rows: AccountRecord[];
  canManage: boolean;
  onOpen: (code: string) => void;
  onEdit: (a: AccountRecord) => void;
  onRetire: (a: AccountRecord) => void;
}) {
  return (
    <>
      <tr className="st-heading">
        <th scope="rowgroup" colSpan={canManage ? 5 : 4}>
          {ROOT_LABEL[root]}
        </th>
      </tr>
      {rows.map((a) => (
        <tr key={a.code} data-retired={!a.isActive || undefined}>
          <td className="st-number">{a.number}</td>
          <th scope="row" className="st-account">
            <button type="button" className="link-button" onClick={() => onOpen(a.code)}>
              {a.name}
            </button>{' '}
            {a.isControl && <StatusBadge status="control" tone="active" label="Control" />}{' '}
            {a.isSystem && !a.isControl && <StatusBadge status="system" tone="muted" label="System" />}{' '}
            {!a.isActive && <StatusBadge status="archived" label="Retired" />}
          </th>
          <td className="muted">{GROUP_LABEL[a.reportGroup]}</td>
          <td className="num">{Number(a.balance) === 0 ? '—' : formatAmount(a.balance)}</td>
          {canManage && (
            <td>
              <span className="row-actions">
                <button type="button" className="button button-small" onClick={() => onEdit(a)}>
                  Edit
                </button>
                {!a.isSystem && (
                  <button type="button" className="button button-small" onClick={() => onRetire(a)}>
                    {a.isActive ? 'Retire' : 'Bring back'}
                  </button>
                )}
              </span>
            </td>
          )}
        </tr>
      ))}
    </>
  );
}
