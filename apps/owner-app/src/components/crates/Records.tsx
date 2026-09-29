'use client';

import { useState } from 'react';
import type { CrateLoss, CrateMovement, CrateSettings, CrateType, TripCrates } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { EmptyRow, Figures } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatDateTime, formatMoney } from '@/lib/format';
import { optionalText, parseDecimal, parseMoney, parseWholeNumber } from '@/lib/parse';
import { CRATE_WRITES, MovementDialog, MovementRows, ReverseDialog } from './Holders';

export function MovementsView({ rows, timeZone, canWrite }: { rows: CrateMovement[]; timeZone: string; canWrite: boolean }) {
  const [reversing, setReversing] = useState<CrateMovement | null>(null);
  return (
    <>
      <MovementRows rows={rows} timeZone={timeZone} canWrite={canWrite} onReverse={setReversing} emptyText="No crates moved in this period." />
      <p className="footnote">Nothing is edited or deleted: a mistake is reversed, and both entries stay in the history.</p>
      {reversing && <ReverseDialog movement={reversing} onClose={() => setReversing(null)} />}
    </>
  );
}

export function LossesView({ rows, currency, timeZone }: { rows: CrateLoss[]; currency: string; timeZone: string }) {
  const crates = rows.reduce((s, l) => s + l.quantity, 0);
  const charged = rows.filter((l) => l.recovery !== 'absorbed');
  const recovered = charged.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) / 100;
  return (
    <>
      <Figures
        items={[
          { label: 'Crates lost', value: crates.toLocaleString('en-IN') },
          { label: 'Charged for', value: charged.reduce((s, l) => s + l.quantity, 0).toLocaleString('en-IN') },
          { label: 'Recovered', value: formatMoney(recovered.toFixed(2), currency) },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Lost by</th>
              <th className="num">Crates</th>
              <th>Recovered</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No crates lost in this period.</EmptyRow>}
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  {formatDateTime(l.occurredAt, timeZone)}
                  <div className="cell-sub">{l.reason}</div>
                </td>
                <td>{l.holder.name}</td>
                <td className="num">
                  {l.quantity} {l.crateCode}
                </td>
                <td>
                  {l.recovery === 'invoiced' ? `Invoiced ${l.invoiceNumber ?? ''}` : l.recovery === 'deducted' ? 'Deducted from payable' : 'Written off'}
                </td>
                <td className="num">
                  {Number(l.amount) ? formatMoney(l.amount, currency) : '—'}
                  {Number(l.taxAmount) ? <div className="cell-sub">incl. GST {formatMoney(l.taxAmount, currency)}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function TripCratesView({
  trip,
  types,
  today,
  timeZone,
  currency,
  canWrite,
}: {
  trip: TripCrates;
  types: CrateType[];
  today: string;
  timeZone: string;
  currency: string;
  canWrite: boolean;
}) {
  const [dialog, setDialog] = useState<'loaded' | 'unloaded' | { stop: TripCrates['stops'][number] } | { reverse: CrateMovement } | null>(null);
  const onVehicle = trip.onVehicle.reduce((s, t) => s + t.balance, 0);
  const vehicleSel = { kind: 'vehicle' as const, id: trip.vehicleId };
  return (
    <>
      <Figures
        items={[
          { label: 'Loaded', value: String(trip.loaded) },
          { label: 'Left on the road', value: String(trip.stops.reduce((s, x) => s + x.dropped, 0)) },
          { label: 'Collected', value: String(trip.stops.reduce((s, x) => s + x.collected, 0)) },
          { label: 'Unloaded', value: String(trip.unloaded) },
          { label: `On ${trip.registrationNumber} now`, value: String(onVehicle), tone: onVehicle && trip.status !== 'in_progress' ? 'attention' : undefined },
        ]}
      />
      {canWrite && trip.status !== 'cancelled' && (
        <ActionBar>
          <button type="button" className="button" onClick={() => setDialog('loaded')}>
            Load from yard
          </button>
          <button type="button" className="button" onClick={() => setDialog('unloaded')}>
            Unload to yard
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Stop</th>
              <th>At</th>
              <th className="num">Left there</th>
              <th className="num">Collected</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trip.stops.length === 0 && <EmptyRow colSpan={5}>This trip has no stops.</EmptyRow>}
            {trip.stops.map((s) => (
              <tr key={s.stopId}>
                <td>
                  {s.sequenceNumber}. {s.stopType === 'pickup' ? 'Pickup' : 'Delivery'}
                </td>
                <td>{s.party.name}</td>
                <td className="num">{s.dropped || '—'}</td>
                <td className="num">{s.collected || '—'}</td>
                <td>
                  {canWrite && trip.status !== 'cancelled' && (
                    <button type="button" className="button" onClick={() => setDialog({ stop: s })}>
                      Record crates
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="detail-subhead">This trip&apos;s crate entries</h3>
      <MovementRows rows={trip.movements} timeZone={timeZone} canWrite={canWrite} onReverse={(m) => setDialog({ reverse: m })} emptyText="No crates recorded on this trip yet." />
      {(dialog === 'loaded' || dialog === 'unloaded') && (
        <MovementDialog kind={dialog} holder={vehicleSel} holderName={trip.registrationNumber} types={types} today={today} currency={currency} onClose={() => setDialog(null)} tripId={trip.tripId} />
      )}
      {dialog !== null && typeof dialog === 'object' && 'stop' in dialog && <StopDialog trip={trip} stop={dialog.stop} types={types} onClose={() => setDialog(null)} />}
      {dialog !== null && typeof dialog === 'object' && 'reverse' in dialog && <ReverseDialog movement={dialog.reverse} onClose={() => setDialog(null)} />}
    </>
  );
}

function StopDialog({ trip, stop, types, onClose }: { trip: TripCrates; stop: TripCrates['stops'][number]; types: CrateType[]; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, { dropped: string; collected: string }>>({});
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `crates/trips/${trip.tripId}/stops/${stop.stopId}`, body), CRATE_WRITES, onClose);
  const active = types.filter((t) => t.isActive);
  const set = (id: string, key: 'dropped' | 'collected', v: string) => setCounts({ ...counts, [id]: { ...(counts[id] ?? { dropped: '', collected: '' }), [key]: v } });
  return (
    <FormDialog
      title={`Crates at ${stop.party.name}`}
      description={<p>Crates left with them come off {trip.registrationNumber}; crates taken back go onto it.</p>}
      submitLabel="Record"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const lines: { crateTypeId: string; dropped: number; collected: number }[] = [];
        for (const t of active) {
          const c = counts[t.id];
          if (!c) continue;
          const d = c.dropped.trim() ? parseWholeNumber(c.dropped, `${t.code} left`, 0, 100000) : { ok: true as const, value: 0 };
          const k = c.collected.trim() ? parseWholeNumber(c.collected, `${t.code} collected`, 0, 100000) : { ok: true as const, value: 0 };
          if (!d.ok) return setProblem(d.error);
          if (!k.ok) return setProblem(k.error);
          if (d.value || k.value) lines.push({ crateTypeId: t.id, dropped: d.value, collected: k.value });
        }
        if (!lines.length) return setProblem('Enter the crates left or collected.');
        setProblem(null);
        save.mutate({ lines, notes: optionalText(notes) });
      }}
    >
      {active.map((t) => (
        <div key={t.id} className="form-wide field-pair">
          <Field label={`${t.code} left there`}>{(p) => <input {...p} inputMode="numeric" value={counts[t.id]?.dropped ?? ''} onChange={(e) => set(t.id, 'dropped', e.target.value)} />}</Field>
          <Field label={`${t.code} collected`}>{(p) => <input {...p} inputMode="numeric" value={counts[t.id]?.collected ?? ''} onChange={(e) => set(t.id, 'collected', e.target.value)} />}</Field>
        </div>
      ))}
      <Field label="Notes (optional)" wide>
        {(p) => <input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

export function CrateSettingsView({ settings, types, canConfigure }: { settings: CrateSettings; types: CrateType[]; canConfigure: boolean }) {
  const [customerDays, setCustomerDays] = useState(String(settings.customerOverdueDays));
  const [farmerDays, setFarmerDays] = useState(String(settings.farmerOverdueDays));
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<CrateType | 'new' | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'crates/settings', body), [KEYS.crates]);
  const dirty = customerDays !== String(settings.customerOverdueDays) || farmerDays !== String(settings.farmerOverdueDays);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Crate type</th>
              <th className="num">Replacement cost</th>
              <th>HSN</th>
              <th className="num">Reorder below</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.length === 0 && <EmptyRow colSpan={5}>No crate types yet.</EmptyRow>}
            {types.map((t) => (
              <tr key={t.id} data-muted={!t.isActive || undefined}>
                <td>
                  {t.code} · {t.name}
                  <div className="cell-sub">
                    {t.capacityKg ? `${Number(t.capacityKg)} kg` : ''}
                    {!t.isActive ? ' Retired' : ''}
                  </div>
                </td>
                <td className="num">{t.replacementCost}</td>
                <td>{t.hsnCode ?? '—'}</td>
                <td className="num">{t.reorderLevel || '—'}</td>
                <td>
                  {canConfigure && (
                    <button type="button" className="button" onClick={() => setEditing(t)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
            Add a crate type
          </button>
        </ActionBar>
      )}
      <h3 className="detail-subhead">When crates are overdue</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const c = parseWholeNumber(customerDays, 'the customer days', 1, 365);
          const f = parseWholeNumber(farmerDays, 'the farmer days', 1, 365);
          if (!c.ok) return setProblem(c.error);
          if (!f.ok) return setProblem(f.error);
          setProblem(null);
          save.mutate({ version: settings.version, customerOverdueDays: c.value, farmerOverdueDays: f.value });
        }}
      >
        <Field label="A customer may hold crates for (days)">
          {(p) => <input {...p} inputMode="numeric" disabled={!canConfigure} value={customerDays} onChange={(e) => setCustomerDays(e.target.value)} />}
        </Field>
        <Field label="A farmer may hold crates for (days)">
          {(p) => <input {...p} inputMode="numeric" disabled={!canConfigure} value={farmerDays} onChange={(e) => setFarmerDays(e.target.value)} />}
        </Field>
        {canConfigure && (
          <div className="form-wide action-bar" style={{ marginTop: 0 }}>
            <button type="submit" className="button button-primary" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
            {problem || save.error ? <span className="form-error">{problem ?? (save.error as Error).message}</span> : null}
          </div>
        )}
      </form>
      <p className="footnote">Past the allowance a holder is flagged; past twice it, the alert turns red.</p>
      {editing && <TypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TypeDialog({ type, onClose }: { type: CrateType | null; onClose: () => void }) {
  const [f, setF] = useState({
    code: type?.code ?? '',
    name: type?.name ?? '',
    capacity: type?.capacityKg ? String(Number(type.capacityKg)) : '',
    cost: type?.replacementCost ?? '',
    hsn: type?.hsnCode ?? '',
    reorder: type ? String(type.reorderLevel) : '0',
    active: type?.isActive ?? true,
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    (body: unknown) => (type ? apiSend('PATCH', `crates/types/${type.id}`, body) : apiSend('POST', 'crates/types', body)),
    [KEYS.crates],
    onClose,
  );
  return (
    <FormDialog
      title={type ? `Crate type ${type.code}` : 'Add a crate type'}
      description={<p>The replacement cost is what a lost crate is charged at. With an HSN, a charge to a customer carries GST at your rate for it.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const cost = parseMoney(f.cost, 'the replacement cost', true);
        const reorder = parseWholeNumber(f.reorder || '0', 'the reorder level', 0, 100000);
        const capacity = f.capacity.trim() ? parseDecimal(f.capacity, 'the capacity', { decimals: 2, positive: true }) : null;
        if (!cost.ok) return setProblem(cost.error);
        if (!reorder.ok) return setProblem(reorder.error);
        if (capacity && !capacity.ok) return setProblem(capacity.error);
        if (!type && !/^[A-Za-z0-9-]{1,12}$/.test(f.code.trim())) return setProblem('The code is 1–12 letters, digits or dashes.');
        if (f.name.trim().length < 2) return setProblem('Enter a name.');
        if (f.hsn.trim() && !/^[0-9]{4}([0-9]{2}){0,2}$/.test(f.hsn.trim())) return setProblem('An HSN is 4, 6 or 8 digits.');
        setProblem(null);
        const common = {
          name: f.name.trim(),
          capacityKg: capacity && capacity.ok ? capacity.value : type ? null : undefined,
          replacementCost: cost.value,
          hsnCode: f.hsn.trim() || (type ? null : undefined),
          reorderLevel: reorder.value,
        };
        save.mutate(type ? { ...common, version: type.version, isActive: f.active } : { ...common, code: f.code.trim().toUpperCase() });
      }}
    >
      {!type && <Field label="Code">{(p) => <input {...p} value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="PL20" />}</Field>}
      <Field label="Name">{(p) => <input {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Plastic crate, 20 kg" />}</Field>
      <Field label="Holds (kg, optional)">{(p) => <input {...p} inputMode="decimal" value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} />}</Field>
      <Field label="Replacement cost">{(p) => <input {...p} inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} />}</Field>
      <Field label="HSN (optional)" hint="Plastic crates are usually 3923">
        {(p) => <input {...p} inputMode="numeric" value={f.hsn} onChange={(e) => set({ hsn: e.target.value })} />}
      </Field>
      <Field label="Warn when the yard has fewer than">{(p) => <input {...p} inputMode="numeric" value={f.reorder} onChange={(e) => set({ reorder: e.target.value })} />}</Field>
      {type && (
        <Field label="In use">
          {(p) => (
            <select {...p} value={f.active ? 'yes' : 'no'} onChange={(e) => set({ active: e.target.value === 'yes' })}>
              <option value="yes">In use</option>
              <option value="no">Retired — can come back, not go out</option>
            </select>
          )}
        </Field>
      )}
    </FormDialog>
  );
}
