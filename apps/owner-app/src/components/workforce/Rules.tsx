'use client';

import { useState } from 'react';
import type { IncentiveRule, MinimumWageRate, PayrollSettings } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatDate, formatMoney } from '@/lib/format';
import { parseDecimal, parseMoney } from '@/lib/parse';
import { ROLE_LABEL, SKILL_LABEL } from './Workers';

type State = { code: string; name: string };
const inForce = (r: { effectiveFrom: string; effectiveTo: string | null }, today: string) => r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today);

function EndDialog({ path, label, from, onClose }: { path: string; label: string; from: string; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const run = useAction(() => apiSend('POST', path, { effectiveTo: date }), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`End ${label}`}
      description={<p>It stops applying after this date; pay already worked out keeps it.</p>}
      submitLabel="End"
      tone="danger"
      pending={run.isPending}
      error={problem ?? run.error}
      onClose={onClose}
      onSubmit={() => {
        if (!date) return setProblem('Choose the last day it applies.');
        setProblem(null);
        run.mutate(undefined);
      }}
    >
      <Field label="Last day">{(p) => <input {...p} type="date" min={from} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
    </FormDialog>
  );
}

export function PayrollSettingsView({ settings, states, canConfigure }: { settings: PayrollSettings; states: State[]; canConfigure: boolean }) {
  const [state, setState] = useState(settings.defaultStateCode ?? '');
  const [policy, setPolicy] = useState(settings.minWagePolicy);
  const save = useAction(
    () => apiSend('PUT', 'workforce/payroll/settings', { version: settings.version, defaultStateCode: state || null, minWagePolicy: policy }),
    [KEYS.workforce],
  );
  const dirty = state !== (settings.defaultStateCode ?? '') || policy !== settings.minWagePolicy;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Field label="Default work state" hint="For workers with no state of their own — decides their minimum wage">
        {(p) => (
          <select {...p} disabled={!canConfigure} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">None</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="When pay is below the minimum wage">
        {(p) => (
          <select {...p} disabled={!canConfigure} value={policy} onChange={(e) => setPolicy(e.target.value as PayrollSettings['minWagePolicy'])}>
            <option value="top_up">Top it up automatically</option>
            <option value="warn">Warn, but don&apos;t pay the difference</option>
          </select>
        )}
      </Field>
      {canConfigure && (
        <div className="form-wide action-bar" style={{ marginTop: 0 }}>
          <button type="submit" className="button button-primary" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {save.error ? <span className="form-error">{(save.error as Error).message}</span> : null}
        </div>
      )}
    </form>
  );
}

export function MinimumWagesView({ rows, states, today, currency, canConfigure }: { rows: MinimumWageRate[]; states: State[]; today: string; currency: string; canConfigure: boolean }) {
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<MinimumWageRate | null>(null);
  const stateName = (c: string) => states.find((s) => s.code === c)?.name ?? c;
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The daily minimum (basic + variable dearness allowance) your state notifies for each skill category. Enter each new
        rate from the date it takes effect — states revise them during the year. Basic pay for the days worked is checked
        against it; incentives don&apos;t count toward it.
      </p>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Add a minimum wage
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>State</th>
              <th>Skill</th>
              <th className="num">Per day</th>
              <th>From</th>
              <th>To</th>
              <th>Source</th>
              <th />
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>None entered — pay isn&apos;t checked against a minimum until you add your state&apos;s rates.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.stateCode} · {stateName(r.stateCode)}
                </td>
                <td>{SKILL_LABEL[r.skillCategory]}</td>
                <td className="num">{formatMoney(r.dailyRate, currency)}</td>
                <td>{formatDate(r.effectiveFrom)}</td>
                <td>{r.effectiveTo ? formatDate(r.effectiveTo) : '—'}</td>
                <td className="muted">{r.source ?? '—'}</td>
                <td>{inForce(r, today) ? <StatusBadge status="active" tone="done" label="In force" /> : <StatusBadge status="inactive" label="Not in force" />}</td>
                {canConfigure && (
                  <td>
                    {!r.effectiveTo && (
                      <button type="button" className="button button-small" onClick={() => setEnding(r)}>
                        End
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <MinimumWageDialog states={states} currency={currency} onClose={() => setAdding(false)} />}
      {ending && <EndDialog path={`workforce/minimum-wages/${ending.id}/end`} label="this minimum wage" from={ending.effectiveFrom} onClose={() => setEnding(null)} />}
    </>
  );
}

function MinimumWageDialog({ states, currency, onClose }: { states: State[]; currency: string; onClose: () => void }) {
  const [f, setF] = useState({ stateCode: '', skillCategory: 'unskilled', dailyRate: '', effectiveFrom: '', source: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'workforce/minimum-wages', body), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title="Add a minimum wage"
      description={<p>An earlier rate for the same state and category ends the day before this one starts.</p>}
      submitLabel="Add"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!f.stateCode) return setProblem('Choose the state.');
        const rate = parseMoney(f.dailyRate, 'the daily rate', true);
        if (!rate.ok) return setProblem(rate.error);
        if (!f.effectiveFrom) return setProblem('Choose the date it takes effect.');
        setProblem(null);
        save.mutate({ stateCode: f.stateCode, skillCategory: f.skillCategory, dailyRate: rate.value, effectiveFrom: f.effectiveFrom, source: f.source.trim() || undefined });
      }}
    >
      <Field label="State">
        {(p) => (
          <select {...p} value={f.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
            <option value="">Choose…</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Skill category">
        {(p) => (
          <select {...p} value={f.skillCategory} onChange={(e) => set({ skillCategory: e.target.value })}>
            {Object.entries(SKILL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Per day (${currency})`} hint="Basic + variable DA">{(p) => <input {...p} inputMode="decimal" value={f.dailyRate} onChange={(e) => set({ dailyRate: e.target.value })} />}</Field>
      <Field label="Takes effect">{(p) => <input {...p} type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
      <Field label="Source (optional)" hint="The notification" wide>{(p) => <input {...p} maxLength={300} value={f.source} onChange={(e) => set({ source: e.target.value })} />}</Field>
    </FormDialog>
  );
}

const BASIS_LABEL = { per_trip: 'Per trip', per_unit: 'Per unit', attendance: 'Attendance bonus' } as const;

function describe(r: IncentiveRule, currency: string): string {
  const t = Number(r.threshold);
  const amount = formatMoney(r.amount, currency);
  switch (r.basis) {
    case 'per_trip':
      return `${amount} for each trip${t ? ` beyond ${t}` : ''}`;
    case 'per_unit':
      return `${amount} for each unit${t ? ` beyond ${t}` : ''}`;
    case 'attendance':
      return `${amount} for working at least ${t} day(s)`;
  }
}

export function IncentiveRulesView({ rows, today, currency, canConfigure }: { rows: IncentiveRule[]; today: string; currency: string; canConfigure: boolean }) {
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<IncentiveRule | null>(null);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>Counted over each pay period, with the rules in force on its last day.</p>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Add an incentive
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Incentive</th>
              <th>Who</th>
              <th>Pays</th>
              <th>From</th>
              <th />
              {canConfigure && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No incentives.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  <div className="cell-sub">{BASIS_LABEL[r.basis]}</div>
                </td>
                <td>{r.roleType ? ROLE_LABEL[r.roleType] : 'Everyone'}</td>
                <td>{describe(r, currency)}</td>
                <td>
                  {formatDate(r.effectiveFrom)}
                  {r.effectiveTo && <div className="cell-sub">to {formatDate(r.effectiveTo)}</div>}
                </td>
                <td>{inForce(r, today) ? <StatusBadge status="active" tone="done" label="In force" /> : <StatusBadge status="inactive" label="Not in force" />}</td>
                {canConfigure && (
                  <td>
                    {!r.effectiveTo && (
                      <button type="button" className="button button-small" onClick={() => setEnding(r)}>
                        End
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <IncentiveDialog currency={currency} onClose={() => setAdding(false)} />}
      {ending && <EndDialog path={`workforce/incentive-rules/${ending.id}/end`} label={ending.name} from={ending.effectiveFrom} onClose={() => setEnding(null)} />}
    </>
  );
}

function IncentiveDialog({ currency, onClose }: { currency: string; onClose: () => void }) {
  const [f, setF] = useState({ name: '', roleType: '', basis: 'per_trip', threshold: '0', amount: '', effectiveFrom: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'workforce/incentive-rules', body), [KEYS.workforce], onClose);
  const thresholdLabel = f.basis === 'attendance' ? 'Days worked, at least' : f.basis === 'per_trip' ? 'Pays for trips beyond' : 'Pays for units beyond';
  return (
    <FormDialog
      title="Add an incentive"
      submitLabel="Add"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (f.name.trim().length < 2) return setProblem('Name it.');
        const threshold = parseDecimal(f.threshold, 'the threshold', { decimals: 3 });
        if (!threshold.ok) return setProblem(threshold.error);
        const amount = parseMoney(f.amount, 'the amount', true);
        if (!amount.ok) return setProblem(amount.error);
        if (!f.effectiveFrom) return setProblem('Choose the date it starts.');
        setProblem(null);
        save.mutate({ name: f.name.trim(), roleType: f.roleType || null, basis: f.basis, threshold: threshold.value, amount: amount.value, effectiveFrom: f.effectiveFrom });
      }}
    >
      <Field label="Name" wide>{(p) => <input {...p} maxLength={100} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
      <Field label="Kind">
        {(p) => (
          <select {...p} value={f.basis} onChange={(e) => set({ basis: e.target.value })}>
            {Object.entries(BASIS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="For">
        {(p) => (
          <select {...p} value={f.roleType} onChange={(e) => set({ roleType: e.target.value })}>
            <option value="">Everyone</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={thresholdLabel}>{(p) => <input {...p} inputMode="decimal" value={f.threshold} onChange={(e) => set({ threshold: e.target.value })} />}</Field>
      <Field label={f.basis === 'attendance' ? `Bonus (${currency})` : `Per ${f.basis === 'per_trip' ? 'trip' : 'unit'} (${currency})`}>
        {(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}
      </Field>
      <Field label="Starts on">{(p) => <input {...p} type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
    </FormDialog>
  );
}
