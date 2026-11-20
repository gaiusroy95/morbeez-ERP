'use client';

import { useState } from 'react';
import type { OpeningBalanceBody } from '@morbeez/shared-types';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { Field, FormDialog } from '@/components/ui/Form';
import { formatDate, formatMoney } from '@/lib/format';
import { optionalText, parseMoney } from '@/lib/parse';
import { useT } from '@/lib/i18n';

/**
 * Opening balances (the client, 20 Nov 2026): "Both customer farmer need
 * opening balance. If they bring old customer in to that it helps." What a
 * customer already owed you, or you already owed a farmer, from the old
 * books — entered once, in the same records as every other bill, so
 * statements, collections and payments carry it (never as a sale or a
 * purchase). Posted by whoever may post journals (accounting:post).
 */
export type Party = 'customer' | 'farmer';

export function useCanPostOpening(): boolean {
  const { data: session } = useSession();
  return hasPermission(session, 'accounting:post');
}

export function postOpeningBalance(party: Party, id: string, body: OpeningBalanceBody) {
  return apiSend<unknown>('POST', `finance/${party === 'customer' ? 'customers' : 'farmers'}/${id}/opening-balance`, body);
}

const LABEL: Record<Party, { field: string; hint: string }> = {
  customer: { field: 'Opening balance — they owe you now (optional)', hint: 'What they owed before Morbeez, from your old books. Due today; it counts against their credit limit.' },
  farmer: { field: 'Opening balance — you owe them now (optional)', hint: 'What you owed them before Morbeez, from your old books. Due today; paid like any other payable.' },
};

/** The amount on a New customer / New farmer form. */
export function OpeningBalanceField({ party, value, onChange }: { party: Party; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={LABEL[party].field} hint={LABEL[party].hint} wide>
      {(props) => <input {...props} inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** Blank is none; otherwise a positive amount to the paisa. */
export function parseOpening(text: string) {
  return text.trim() === '' ? ({ ok: true, value: undefined } as const) : parseMoney(text, 'the opening balance', true);
}

/** On a profile: the balance brought forward, or a way to enter it. */
export function OpeningBalanceLine({
  opening,
  currency,
}: {
  opening: { amount: string; outstanding: string; asOf: string; invoiceNumber?: string } | null | undefined;
  currency: string;
}) {
  const t = useT();
  if (!opening) return <>—</>;
  const settled = Number(opening.outstanding) <= 0;
  return (
    <>
      {formatMoney(opening.amount, currency)}
      <div className="cell-sub">
        {[opening.invoiceNumber, t('as of {date}', { date: formatDate(opening.asOf) }), settled ? t('settled') : t('{amount} still owed', { amount: formatMoney(opening.outstanding, currency) })]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </>
  );
}

/** Entering it later, from the profile: the amount, the day it stood at, when it's due, where it came from. */
export function OpeningBalanceDialog({ party, id, name, onClose }: { party: Party; id: string; name: string; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState({ amount: '', asOf: '', dueDate: '', note: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: OpeningBalanceBody) => postOpeningBalance(party, id, body),
    [party === 'customer' ? KEYS.customers : ['farmers'], KEYS.finance],
    onClose,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  return (
    <FormDialog
      title={t('Opening balance for {name}', { name })}
      description={<p>{t(party === 'customer' ? 'What they owed you before Morbeez, from your old books. Entered once; to correct it later, issue a credit note.' : 'What you owed them before Morbeez, from your old books. Entered once.')}</p>}
      submitLabel={t('Save opening balance')}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const amount = parseMoney(form.amount, 'the opening balance', true);
        if (!amount.ok) return setProblem(amount.error);
        setProblem(null);
        save.mutate({ amount: amount.value, asOf: form.asOf || undefined, dueDate: form.dueDate || undefined, note: optionalText(form.note) });
      }}
    >
      <Field label={party === 'customer' ? 'They owe you' : 'You owe them'}>
        {(props) => <input {...props} inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />}
      </Field>
      <Field label="As of (optional)" hint="The day the old books stood at — today if blank; not in a closed period">
        {(props) => <input {...props} type="date" value={form.asOf} onChange={(e) => set({ asOf: e.target.value })} />}
      </Field>
      <Field label="Due (optional)" hint="Due on the as-of day if blank">
        {(props) => <input {...props} type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}
      </Field>
      <Field label="Note (optional)" hint="Where it came from, e.g. old ledger page 14" wide>
        {(props) => <input {...props} maxLength={200} value={form.note} onChange={(e) => set({ note: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}
