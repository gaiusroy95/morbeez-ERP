'use client';

import { useState } from 'react';
import type { PayRate, WorkerDetail, WorkerProfileBody, WorkerRow } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useWorker } from '@/lib/hooks/use-workforce';
import { formatDate, formatMoney } from '@/lib/format';
import { parseMoney } from '@/lib/parse';

export const SKILL_LABEL = { unskilled: 'Unskilled', semi_skilled: 'Semi-skilled', skilled: 'Skilled', highly_skilled: 'Highly skilled' } as const;
export const EMPLOYMENT_LABEL = { permanent: 'Permanent', casual: 'Casual (daily)', contract: 'Contract' } as const;
export const ROLE_LABEL: Record<string, string> = { driver: 'Driver', warehouse: 'Warehouse', procurement: 'Procurement', finance: 'Finance', other: 'Other' };

export function rateLabel(rate: PayRate | null, currency: string): string {
  if (!rate) return 'No pay rate';
  const amount = formatMoney(rate.rate, currency);
  switch (rate.payBasis) {
    case 'monthly':
      return `${amount} a month`;
    case 'daily':
      return `${amount} a day`;
    case 'hourly':
      return `${amount} an hour`;
    case 'piece':
      return `${amount} per ${rate.unitLabel}`;
  }
}

export function WorkersTable({
  workers,
  currency,
  selected,
  onSelect,
}: {
  workers: WorkerRow[];
  currency: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Worker</th>
            <th>Role</th>
            <th>Employment</th>
            <th>Pay</th>
            <th className="num">Advance due</th>
          </tr>
        </thead>
        <tbody>
          {workers.length === 0 && <EmptyRow colSpan={5}>No workers yet.</EmptyRow>}
          {workers.map((w) => (
            <SelectableRow key={w.employeeId} selected={selected === w.employeeId} onSelect={() => onSelect(w.employeeId)} label={w.name}>
              <td>
                {w.name} {w.status === 'archived' && <StatusBadge status="archived" />}
                {w.profileVersion === 0 && <div className="cell-sub">Employment details not set</div>}
              </td>
              <td>{ROLE_LABEL[w.roleType] ?? w.roleType}</td>
              <td>
                {EMPLOYMENT_LABEL[w.employmentType]}
                <div className="cell-sub">{SKILL_LABEL[w.skillCategory]}</div>
              </td>
              <td>{w.currentRate ? rateLabel(w.currentRate, currency) : <StatusBadge status="missing" tone="attention" label="No pay rate" />}</td>
              <td className="num">{Number(w.advanceOutstanding) ? formatMoney(w.advanceOutstanding, currency) : '—'}</td>
            </SelectableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkerPanel({
  id,
  currency,
  states,
  canWrite,
  canConfigure,
  onClose,
}: {
  id: string;
  currency: string;
  states: { code: string; name: string }[];
  canWrite: boolean;
  canConfigure: boolean;
  onClose: () => void;
}) {
  const { data, error, isPending, refetch } = useWorker(id);
  const [dialog, setDialog] = useState<'profile' | 'rate' | null>(null);
  if (isPending || error || !data) {
    return (
      <DetailPanel title="Worker" onClose={onClose}>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  const state = states.find((s) => s.code === data.workStateCode)?.name;
  return (
    <DetailPanel title={data.name} onClose={onClose}>
      <KeyValues
        items={[
          ['Role', ROLE_LABEL[data.roleType] ?? data.roleType],
          ['Employment', EMPLOYMENT_LABEL[data.employmentType]],
          ['Skill (for minimum wage)', SKILL_LABEL[data.skillCategory]],
          ['Works in', state ? `${data.workStateCode} · ${state}` : 'Default state'],
          ['Joined', data.joinedOn ? formatDate(data.joinedOn) : '—'],
          ['Left', data.leftOn ? formatDate(data.leftOn) : '—'],
          ['Phone', data.phone ?? '—'],
          ['Login', data.hasLogin ? 'Yes' : 'No'],
        ]}
      />
      <ActionBar>
        {canWrite && (
          <button type="button" className="button" onClick={() => setDialog('profile')}>
            Edit employment details
          </button>
        )}
        {canConfigure && (
          <button type="button" className="button button-primary" onClick={() => setDialog('rate')}>
            New pay rate
          </button>
        )}
      </ActionBar>
      <h3 className="detail-subhead">Pay rates</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rate</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {data.rates.length === 0 && <EmptyRow colSpan={3}>No pay rate — this worker can&apos;t be paid until one is set.</EmptyRow>}
            {data.rates.map((r) => (
              <tr key={r.id}>
                <td>{rateLabel(r, currency)}</td>
                <td>{formatDate(r.effectiveFrom)}</td>
                <td>{r.effectiveTo ? formatDate(r.effectiveTo) : 'Current'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">A rate change starts from a date; pay already settled keeps the rate it was worked out with.</p>
      {dialog === 'profile' && <ProfileDialog worker={data} states={states} onClose={() => setDialog(null)} />}
      {dialog === 'rate' && <RateDialog worker={data} currency={currency} onClose={() => setDialog(null)} />}
    </DetailPanel>
  );
}

function ProfileDialog({ worker, states, onClose }: { worker: WorkerDetail; states: { code: string; name: string }[]; onClose: () => void }) {
  const [f, setF] = useState({
    employmentType: worker.employmentType,
    skillCategory: worker.skillCategory,
    workStateCode: worker.workStateCode ?? '',
    joinedOn: worker.joinedOn ?? '',
    leftOn: worker.leftOn ?? '',
    phone: worker.phone ?? '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const save = useAction(
    (body: WorkerProfileBody) => apiSend('PUT', `workforce/workers/${worker.employeeId}/profile`, body),
    [KEYS.workforce],
    onClose,
  );
  return (
    <FormDialog
      title={`Employment — ${worker.name}`}
      submitLabel="Save"
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() =>
        save.mutate({
          version: worker.profileVersion,
          employmentType: f.employmentType,
          skillCategory: f.skillCategory,
          workStateCode: f.workStateCode || null,
          joinedOn: f.joinedOn || null,
          leftOn: f.leftOn || null,
          phone: f.phone.trim() || null,
        })
      }
    >
      <Field label="Employment">
        {(p) => (
          <select {...p} value={f.employmentType} onChange={(e) => set({ employmentType: e.target.value as typeof f.employmentType })}>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Skill category" hint="Decides which minimum wage applies">
        {(p) => (
          <select {...p} value={f.skillCategory} onChange={(e) => set({ skillCategory: e.target.value as typeof f.skillCategory })}>
            {Object.entries(SKILL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Works in (state)" hint="Blank uses the payroll default">
        {(p) => (
          <select {...p} value={f.workStateCode} onChange={(e) => set({ workStateCode: e.target.value })}>
            <option value="">Payroll default</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Phone (optional)">{(p) => <input {...p} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
      <Field label="Joined on">{(p) => <input {...p} type="date" value={f.joinedOn} onChange={(e) => set({ joinedOn: e.target.value })} />}</Field>
      <Field label="Left on (optional)">{(p) => <input {...p} type="date" value={f.leftOn} onChange={(e) => set({ leftOn: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function RateDialog({ worker, currency, onClose }: { worker: WorkerDetail; currency: string; onClose: () => void }) {
  const [basis, setBasis] = useState<PayRate['payBasis']>(worker.currentRate?.payBasis ?? 'daily');
  const [rate, setRate] = useState('');
  const [unit, setUnit] = useState(worker.currentRate?.unitLabel ?? 'crate');
  const [from, setFrom] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `workforce/workers/${worker.employeeId}/pay-rates`, body), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title={`New pay rate — ${worker.name}`}
      description={<p>The current rate ends the day before this one starts.</p>}
      submitLabel="Set rate"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const r = parseMoney(rate, 'the rate', true);
        if (!r.ok) return setProblem(r.error);
        if (!from) return setProblem('Choose the date it starts.');
        if (basis === 'piece' && !unit.trim()) return setProblem('Say what one piece is.');
        setProblem(null);
        save.mutate({ payBasis: basis, rate: r.value, unitLabel: basis === 'piece' ? unit.trim() : undefined, effectiveFrom: from });
      }}
    >
      <Field label="Paid">
        {(p) => (
          <select {...p} value={basis} onChange={(e) => setBasis(e.target.value as PayRate['payBasis'])}>
            <option value="monthly">A monthly salary</option>
            <option value="daily">By the day</option>
            <option value="hourly">By the hour</option>
            <option value="piece">By the piece</option>
          </select>
        )}
      </Field>
      <Field label={`Rate (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
      {basis === 'piece' && <Field label="Per">{(p) => <input {...p} maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} />}</Field>}
      <Field label="Starts on">{(p) => <input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
    </FormDialog>
  );
}

export function AddWorkerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('warehouse');
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction(
    (body: { name: string; roleType: string }) => apiSend<{ id: string }>('POST', 'workforce', body),
    [KEYS.workforce, ['lookup', 'employees']],
    (created) => onAdded(created.id),
  );
  return (
    <FormDialog
      title="Add a worker"
      description={<p>Then set their employment details and pay rate.</p>}
      submitLabel="Add worker"
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return setProblem('Enter their name.');
        setProblem(null);
        add.mutate({ name: name.trim(), roleType: role });
      }}
    >
      <Field label="Name">{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Role">
        {(p) => (
          <select {...p} value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
    </FormDialog>
  );
}
