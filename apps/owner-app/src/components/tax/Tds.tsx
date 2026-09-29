'use client';

import { useState } from 'react';
import type { AccountRecord, TdsRegister, TdsSectionView } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatAmount, formatDate, formatMoney } from '@/lib/format';
import { parseMoney } from '@/lib/parse';
import { sumMoney } from '@/lib/decimal';

const SOURCE_LABEL: Record<string, string> = { farmer_payable: 'Farmer lot', tds_expense_payment: 'Expense payment' };

export function TdsView({
  register,
  sections,
  expenseAccounts,
  today,
  canFile,
}: {
  register: TdsRegister;
  sections: TdsSectionView[];
  expenseAccounts: AccountRecord[] | null;
  today: string;
  canFile: boolean;
}) {
  const [dialog, setDialog] = useState<'deduct' | 'deposit' | null>(null);
  const pending = register.deductions.filter((d) => !d.challanId);
  const currency = register.currency;
  return (
    <div className="stack">
      {!register.tan && (
        <p className="action-note">No TAN in the tax settings — it&apos;s needed on every challan and on Form 26Q.</p>
      )}
      {register.overdue.map((o) => (
        <p key={o.sectionCode} className="action-note" data-tone="bad">
          {formatMoney(o.amount, currency)} under {o.sectionCode} was due for deposit by {formatDate(o.dueBy)}. Interest
          runs on late deposits.
        </p>
      ))}
      <Figures
        items={[
          { label: 'Deducted this quarter', value: formatMoney(sumMoney(register.deductions.map((d) => d.tdsAmount)), currency) },
          { label: 'Deposited', value: formatMoney(sumMoney(register.challans.map((c) => c.taxAmount)), currency) },
          {
            label: 'Waiting to deposit (all periods)',
            value: formatMoney(register.pendingDeposit, currency),
            tone: Number(register.pendingDeposit) > 0 ? 'attention' : undefined,
          },
        ]}
      />
      {canFile && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setDialog('deposit')} disabled={pending.length === 0}>
            Record deposit (challan)
          </button>
          <button type="button" className="button" onClick={() => setDialog('deduct')}>
            TDS on a payment
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table statement">
          <caption className="st-caption">
            Deductions, Q{register.quarter} {register.financialYear} ({formatDate(register.from)} – {formatDate(register.to)}) — what Form 26Q reports
          </caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Section</th>
              <th>Deductee</th>
              <th className="num">Paid / credited</th>
              <th className="num">Rate</th>
              <th className="num">TDS</th>
              <th>Deposit</th>
            </tr>
          </thead>
          <tbody>
            {register.deductions.length === 0 && <EmptyRow colSpan={7}>No TDS deducted this quarter.</EmptyRow>}
            {register.deductions.map((d) => (
              <tr key={d.id}>
                <td>
                  {formatDate(d.deductedOn)}
                  <div className="cell-sub">{SOURCE_LABEL[d.sourceType] ?? d.sourceType}</div>
                </td>
                <td className="st-number">{d.sectionCode}</td>
                <td>
                  {d.payeeName}
                  <div className="cell-sub">{d.payeePan ?? 'No PAN'}</div>
                </td>
                <td className="num">
                  {formatAmount(d.grossAmount)}
                  {d.baseAmount !== d.grossAmount && <div className="cell-sub">taxed on {formatAmount(d.baseAmount)}</div>}
                </td>
                <td className="num">{Number(d.rate)}%</td>
                <td className="num">{formatAmount(d.tdsAmount)}</td>
                <td>
                  {d.challan ? (
                    <>
                      <StatusBadge status="deposited" tone="done" label="Deposited" />
                      <div className="cell-sub">
                        BSR {d.challan.bsrCode} · {d.challan.challanSerial} · {formatDate(d.challan.paidOn)}
                      </div>
                    </>
                  ) : (
                    <>
                      <StatusBadge status="pending" tone={d.depositDueBy < today ? 'bad' : 'attention'} label={d.depositDueBy < today ? 'Overdue' : 'To deposit'} />
                      <div className="cell-sub">by {formatDate(d.depositDueBy)}</div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="st-caption">By section</caption>
          <thead>
            <tr>
              <th>Section</th>
              <th className="num">Deductions</th>
              <th className="num">Amount taxed</th>
              <th className="num">TDS</th>
              <th className="num">Deposited</th>
              <th className="num">Pending</th>
            </tr>
          </thead>
          <tbody>
            {register.bySection.length === 0 && <EmptyRow colSpan={6}>None.</EmptyRow>}
            {register.bySection.map((s) => (
              <tr key={s.sectionCode}>
                <td className="st-number">{s.sectionCode}</td>
                <td className="num">{s.deductions}</td>
                <td className="num">{formatAmount(s.baseAmount)}</td>
                <td className="num">{formatAmount(s.tdsAmount)}</td>
                <td className="num">{formatAmount(s.deposited)}</td>
                <td className="num" data-tone={Number(s.pending) > 0 ? 'attention' : undefined}>
                  {formatAmount(s.pending)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {register.challans.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="st-caption">Challans (ITNS 281)</caption>
            <thead>
              <tr>
                <th>Paid on</th>
                <th>Section</th>
                <th>BSR code</th>
                <th>Serial</th>
                <th className="num">Tax</th>
                <th className="num">Interest</th>
                <th className="num">Deductions</th>
              </tr>
            </thead>
            <tbody>
              {register.challans.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.paidOn)}</td>
                  <td className="st-number">{c.sectionCode}</td>
                  <td className="st-number">{c.bsrCode}</td>
                  <td className="st-number">{c.challanSerial}</td>
                  <td className="num">{formatAmount(c.taxAmount)}</td>
                  <td className="num">{Number(c.interest) ? formatAmount(c.interest) : '—'}</td>
                  <td className="num">{c.deductions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog === 'deposit' && <DepositDialog pending={pending} today={today} onClose={() => setDialog(null)} />}
      {dialog === 'deduct' && <DeductDialog sections={sections} expenseAccounts={expenseAccounts} today={today} onClose={() => setDialog(null)} />}
    </div>
  );
}

function DepositDialog({ pending, today, onClose }: { pending: TdsRegister['deductions']; today: string; onClose: () => void }) {
  const codes = [...new Set(pending.map((d) => d.sectionCode))];
  const [section, setSection] = useState(codes[0] ?? '');
  const inSection = pending.filter((d) => d.sectionCode === section);
  const [f, setF] = useState({ paidOn: today, bsrCode: '', challanSerial: '', interest: '', paidFrom: 'bank' });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'tax/tds/challans', body), [KEYS.tax], onClose);
  return (
    <FormDialog
      title="Record a TDS deposit"
      description={
        <p>
          One challan pays one section. Covers {inSection.length} deduction(s) this quarter totalling{' '}
          <strong>{formatAmount(sumMoney(inSection.map((d) => d.tdsAmount)))}</strong>.
        </p>
      }
      submitLabel="Record deposit"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!/^[0-9]{7}$/.test(f.bsrCode)) return setProblem('The BSR code is 7 digits.');
        if (!/^[0-9]{5}$/.test(f.challanSerial)) return setProblem('The challan serial number is 5 digits.');
        const interest = f.interest.trim() ? parseMoney(f.interest, 'the interest') : ({ ok: true, value: 0 } as const);
        if (!interest.ok) return setProblem(interest.error);
        setProblem(null);
        save.mutate({
          sectionCode: section,
          deductionIds: inSection.map((d) => d.id),
          interest: interest.value,
          paidOn: f.paidOn,
          bsrCode: f.bsrCode,
          challanSerial: f.challanSerial,
          paidFrom: f.paidFrom,
        });
      }}
    >
      <Field label="Section">
        {(p) => (
          <select {...p} value={section} onChange={(e) => setSection(e.target.value)}>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Paid on">{(p) => <input {...p} type="date" max={today} value={f.paidOn} onChange={(e) => set({ paidOn: e.target.value })} />}</Field>
      <Field label="BSR code">{(p) => <input {...p} inputMode="numeric" maxLength={7} value={f.bsrCode} onChange={(e) => set({ bsrCode: e.target.value })} />}</Field>
      <Field label="Challan serial number">{(p) => <input {...p} inputMode="numeric" maxLength={5} value={f.challanSerial} onChange={(e) => set({ challanSerial: e.target.value })} />}</Field>
      <Field label="Interest for late deposit (₹, optional)" hint="Booked as a finance cost">
        {(p) => <input {...p} inputMode="decimal" value={f.interest} onChange={(e) => set({ interest: e.target.value })} />}
      </Field>
      <Field label="Paid from">
        {(p) => (
          <select {...p} value={f.paidFrom} onChange={(e) => set({ paidFrom: e.target.value })}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash on hand</option>
          </select>
        )}
      </Field>
    </FormDialog>
  );
}

function DeductDialog({
  sections,
  expenseAccounts,
  today,
  onClose,
}: {
  sections: TdsSectionView[];
  expenseAccounts: AccountRecord[] | null;
  today: string;
  onClose: () => void;
}) {
  const codes = [...new Set(sections.filter((s) => s.inForce).map((s) => s.code))];
  const [f, setF] = useState({
    sectionCode: codes.find((c) => c.startsWith('194I')) ?? codes[0] ?? '',
    payeeName: '',
    pan: '',
    grossAmount: '',
    date: today,
    expenseAccountCode: '',
    paidFrom: 'bank',
    reference: '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'tax/tds/deductions', body), [KEYS.tax, KEYS.finance], onClose);
  const section = sections.find((s) => s.code === f.sectionCode && s.inForce);
  const accounts = (expenseAccounts ?? []).filter((a) => a.rootType === 'expense' && a.isActive && !a.isControl);
  return (
    <FormDialog
      title="TDS on a payment"
      description={
        <p>
          For rent, hired transport, professional fees and the like: the expense is booked in full, the payee paid the rest,
          and the TDS owed to the government.
          {section && (section.singleThreshold || section.annualThreshold) && (
            <>
              {' '}
              {section.code} applies above{' '}
              {[
                section.singleThreshold && `₹${Number(section.singleThreshold).toLocaleString('en-IN')} a payment`,
                section.annualThreshold && `₹${Number(section.annualThreshold).toLocaleString('en-IN')} a year`,
              ]
                .filter(Boolean)
                .join(' or ')}
              .
            </>
          )}
        </p>
      }
      submitLabel="Record"
      size="wide"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const gross = parseMoney(f.grossAmount, 'the amount', true);
        if (!gross.ok) return setProblem(gross.error);
        if (f.payeeName.trim().length < 2) return setProblem('Enter who was paid.');
        if (!f.expenseAccountCode) return setProblem('Choose the expense account.');
        if (f.pan.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan.trim())) return setProblem('A PAN is 5 letters, 4 digits, 1 letter.');
        setProblem(null);
        save.mutate({
          sectionCode: f.sectionCode,
          payeeName: f.payeeName.trim(),
          pan: f.pan.trim() || undefined,
          grossAmount: gross.value,
          date: f.date,
          expenseAccountCode: f.expenseAccountCode,
          paidFrom: f.paidFrom,
          reference: f.reference.trim() || undefined,
        });
      }}
    >
      <Field label="Section">
        {(p) => (
          <select {...p} value={f.sectionCode} onChange={(e) => set({ sectionCode: e.target.value })}>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={f.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
      <Field label="Paid to">{(p) => <input {...p} value={f.payeeName} onChange={(e) => set({ payeeName: e.target.value })} />}</Field>
      <Field label="Their PAN" hint="Without it, the higher no-PAN rate applies">
        {(p) => <input {...p} maxLength={10} value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />}
      </Field>
      <Field label="Amount before TDS (₹)">{(p) => <input {...p} inputMode="decimal" value={f.grossAmount} onChange={(e) => set({ grossAmount: e.target.value })} />}</Field>
      <Field label="Expense account">
        {(p) =>
          expenseAccounts ? (
            <select {...p} value={f.expenseAccountCode} onChange={(e) => set({ expenseAccountCode: e.target.value })}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.number} · {a.name}
                </option>
              ))}
            </select>
          ) : (
            <input {...p} placeholder="Account code, e.g. rent" value={f.expenseAccountCode} onChange={(e) => set({ expenseAccountCode: e.target.value })} />
          )
        }
      </Field>
      <Field label="Paid from">
        {(p) => (
          <select {...p} value={f.paidFrom} onChange={(e) => set({ paidFrom: e.target.value })}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash on hand</option>
          </select>
        )}
      </Field>
      <Field label="Reference (optional)">{(p) => <input {...p} maxLength={100} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />}</Field>
    </FormDialog>
  );
}
