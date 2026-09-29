'use client';

import { useState } from 'react';
import type { AssignmentRecord, WorkerRow } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatDate } from '@/lib/format';
import { parseDecimal } from '@/lib/parse';

export const KIND_LABEL: Record<string, string> = {
  trip: 'Trip',
  warehouse: 'Warehouse shift',
  loading: 'Loading',
  grading: 'Grading',
  market: 'Market',
  other: 'Other',
};

const STATUS: Record<AssignmentRecord['status'], { tone: 'done' | 'muted' | 'bad' | 'attention'; label: string }> = {
  planned: { tone: 'attention', label: 'Planned' },
  completed: { tone: 'done', label: 'Worked' },
  absent: { tone: 'bad', label: 'Absent' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

const num = (v: string | null) => (v === null ? '' : String(Number(v)));

export function AssignmentsView({
  rows,
  workers,
  today,
  canWrite,
}: {
  rows: AssignmentRecord[];
  workers: WorkerRow[];
  today: string;
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AssignmentRecord | null>(null);
  const present = new Set(rows.filter((r) => r.status === 'completed').map((r) => `${r.employeeId}:${r.workDate}`)).size;
  const absent = rows.filter((r) => r.status === 'absent').length;
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        What each person did, day by day — this is also attendance. {present} worker-day(s) worked, {absent} absence(s).
        Completed trips are recorded automatically for their drivers.
      </p>
      {canWrite && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Record work
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Worker</th>
              <th>Work</th>
              <th>Status</th>
              <th className="num">Hours</th>
              <th className="num">Units</th>
              <th>Pay</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No work recorded in this period.</EmptyRow>}
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.workDate)}</td>
                <td>{a.employeeName}</td>
                <td>
                  {KIND_LABEL[a.kind]}
                  {a.notes && <div className="cell-sub">{a.notes}</div>}
                </td>
                <td>
                  <StatusBadge status={a.status} tone={STATUS[a.status].tone} label={STATUS[a.status].label} />
                </td>
                <td className="num">{num(a.hours) || '—'}</td>
                <td className="num">{num(a.units) || '—'}</td>
                <td>{a.settlementNumber ? <span className="muted">Settlement #{a.settlementNumber}</span> : '—'}</td>
                {canWrite && (
                  <td>
                    {!a.settlementId && a.kind !== 'trip' && (
                      <button type="button" className="button button-small" onClick={() => setEditing(a)}>
                        Update
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <NewAssignmentDialog workers={workers.filter((w) => w.status === 'active')} today={today} onClose={() => setAdding(false)} />}
      {editing && <UpdateAssignmentDialog assignment={editing} today={today} onClose={() => setEditing(null)} />}
    </>
  );
}

function parseOptional(text: string, label: string, decimals: 2 | 3, max?: number) {
  if (!text.trim()) return { ok: true as const, value: undefined };
  return parseDecimal(text, label, { decimals, max });
}

function NewAssignmentDialog({ workers, today, onClose }: { workers: WorkerRow[]; today: string; onClose: () => void }) {
  const [f, setF] = useState({ employeeId: '', workDate: today, kind: 'warehouse', status: 'completed', hours: '', units: '', notes: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'workforce/assignments', body), [KEYS.workforce], onClose);
  return (
    <FormDialog
      title="Record work"
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!f.employeeId) return setProblem('Choose the worker.');
        const hours = parseOptional(f.hours, 'the hours', 2, 24);
        const units = parseOptional(f.units, 'the units', 3);
        if (!hours.ok) return setProblem(hours.error);
        if (!units.ok) return setProblem(units.error);
        setProblem(null);
        save.mutate({ employeeId: f.employeeId, workDate: f.workDate, kind: f.kind, status: f.status, hours: hours.value, units: units.value, notes: f.notes.trim() || undefined });
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
      <Field label="Date">{(p) => <input {...p} type="date" max={f.status === 'planned' ? undefined : today} value={f.workDate} onChange={(e) => set({ workDate: e.target.value })} />}</Field>
      <Field label="Work">
        {(p) => (
          <select {...p} value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
            {Object.entries(KIND_LABEL)
              .filter(([k]) => k !== 'trip')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        )}
      </Field>
      <Field label="Status">
        {(p) => (
          <select {...p} value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="completed">Worked</option>
            <option value="planned">Planned</option>
            <option value="absent">Absent</option>
          </select>
        )}
      </Field>
      <Field label="Hours (optional)" hint="Needed for hourly pay">{(p) => <input {...p} inputMode="decimal" value={f.hours} onChange={(e) => set({ hours: e.target.value })} />}</Field>
      <Field label="Units (optional)" hint="Crates, bags, kg — for piece rates">{(p) => <input {...p} inputMode="decimal" value={f.units} onChange={(e) => set({ units: e.target.value })} />}</Field>
      <Field label="Notes (optional)" wide>{(p) => <input {...p} maxLength={300} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function UpdateAssignmentDialog({ assignment, today, onClose }: { assignment: AssignmentRecord; today: string; onClose: () => void }) {
  const [f, setF] = useState({ status: assignment.status, hours: num(assignment.hours), units: num(assignment.units), notes: assignment.notes ?? '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PATCH', `workforce/assignments/${assignment.id}`, body), [KEYS.workforce], onClose);
  const future = assignment.workDate > today;
  return (
    <FormDialog
      title={`${assignment.employeeName} — ${formatDate(assignment.workDate)}`}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const hours = parseOptional(f.hours, 'the hours', 2, 24);
        const units = parseOptional(f.units, 'the units', 3);
        if (!hours.ok) return setProblem(hours.error);
        if (!units.ok) return setProblem(units.error);
        setProblem(null);
        save.mutate({ version: assignment.version, status: f.status, hours: hours.value ?? null, units: units.value ?? null, notes: f.notes.trim() || null });
      }}
    >
      <Field label="Status">
        {(p) => (
          <select {...p} value={f.status} onChange={(e) => set({ status: e.target.value as AssignmentRecord['status'] })}>
            <option value="planned">Planned</option>
            <option value="completed" disabled={future}>
              Worked
            </option>
            <option value="absent" disabled={future}>
              Absent
            </option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
      </Field>
      <Field label="Hours">{(p) => <input {...p} inputMode="decimal" value={f.hours} onChange={(e) => set({ hours: e.target.value })} />}</Field>
      <Field label="Units">{(p) => <input {...p} inputMode="decimal" value={f.units} onChange={(e) => set({ units: e.target.value })} />}</Field>
      <Field label="Notes">{(p) => <input {...p} maxLength={300} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
    </FormDialog>
  );
}
