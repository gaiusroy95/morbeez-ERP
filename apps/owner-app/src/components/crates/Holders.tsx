'use client';

import { useState } from 'react';
import type { CrateAlert, CrateHolderDetail, CrateHolderKind, CrateHolding, CrateMovement, CrateMovementKind, CrateOverview, CrateType } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCrateHolder, useCrateParties } from '@/lib/hooks/use-crates';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { optionalText, parseMoney, parseWholeNumber } from '@/lib/parse';

// What a crate write moves: crate views, and — for a charge or a
// purchase — receivables, payables and the books.
export const CRATE_WRITES = [KEYS.crates, KEYS.finance, KEYS.dashboard];

export const KIND_LABEL: Record<CrateMovementKind, string> = {
  purchased: 'Bought',
  opening: 'Opening / counted in',
  issued: 'Issued',
  returned: 'Returned',
  loaded: 'Loaded on vehicle',
  unloaded: 'Unloaded to yard',
  delivered: 'Left on the road',
  collected: 'Collected on the road',
  lost: 'Lost',
  correction: 'Correction',
};
export const HOLDER_LABEL: Record<CrateHolderKind, string> = { yard: 'Yard', customer: 'Customer', farmer: 'Farmer', vehicle: 'Vehicle' };
const RECOVERY_LABEL = { absorbed: 'Written off', invoiced: 'Invoiced', deducted: 'Deducted from payable' } as const;

export type HolderSel = { kind: CrateHolderKind; id: string | null };

const plural = (n: number, word = 'crate') => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;

export function AlertsList({ alerts, onOpen }: { alerts: CrateAlert[]; onOpen: (h: HolderSel) => void }) {
  if (alerts.length === 0) return <p className="muted">Nothing needs attention: every crate is where it should be.</p>;
  return (
    <ul className="alert-list">
      {alerts.map((a, i) => (
        <li key={i} data-tone={a.severity}>
          <StatusBadge status={a.kind} tone={a.severity} label={a.severity === 'bad' ? 'Act now' : 'Check'} />
          <button type="button" className="link-button" onClick={() => onOpen({ kind: a.holderKind, id: a.holderId })}>
            {a.holderName}
          </button>
          <span>{a.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewView({ overview, onOpen }: { overview: CrateOverview; onOpen: (h: HolderSel) => void }) {
  const sum = (k: 'owned' | 'yard' | 'customers' | 'farmers' | 'vehicles' | 'lost') => overview.types.reduce((s, t) => s + t[k], 0);
  return (
    <>
      <Figures
        items={[
          { label: 'Crates owned', value: plural(sum('owned')) },
          { label: 'In the yard', value: sum('yard').toLocaleString('en-IN') },
          { label: 'With customers and farmers', value: (sum('customers') + sum('farmers')).toLocaleString('en-IN') },
          { label: 'On vehicles', value: sum('vehicles').toLocaleString('en-IN') },
          { label: 'Lost so far', value: sum('lost').toLocaleString('en-IN'), tone: sum('lost') ? 'attention' : undefined },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Crate type</th>
              <th className="num">Owned</th>
              <th className="num">Yard</th>
              <th className="num">Customers</th>
              <th className="num">Farmers</th>
              <th className="num">Vehicles</th>
              <th className="num">Lost</th>
            </tr>
          </thead>
          <tbody>
            {overview.types.length === 0 && <EmptyRow colSpan={7}>No crate types yet — add them under Settings.</EmptyRow>}
            {overview.types.map((t) => (
              <tr key={t.id} data-muted={!t.isActive || undefined}>
                <td>
                  {t.code} · {t.name}
                  <div className="cell-sub">Replacement {t.replacementCost}{t.reorderLevel ? ` · reorder below ${t.reorderLevel}` : ''}</div>
                </td>
                <td className="num strong">{t.owned}</td>
                <td className="num" data-tone={t.reorderLevel && t.yard < t.reorderLevel ? 'attention' : undefined}>
                  {t.yard}
                </td>
                <td className="num">{t.customers}</td>
                <td className="num">{t.farmers}</td>
                <td className="num">{t.vehicles}</td>
                <td className="num">{t.lost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ActionBar>
        <button type="button" className="button" onClick={() => onOpen({ kind: 'yard', id: null })}>
          Open the yard
        </button>
      </ActionBar>
      <h3 className="detail-subhead">Alerts</h3>
      <AlertsList alerts={overview.alerts} onOpen={onOpen} />
    </>
  );
}

export function HoldingsTable({
  rows,
  kind,
  currency,
  selected,
  onSelect,
}: {
  rows: CrateHolding[];
  kind: CrateHolderKind;
  currency: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const party = kind === 'customer' || kind === 'farmer';
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{HOLDER_LABEL[kind]}</th>
            <th className="num">Crates</th>
            <th>By type</th>
            <th className="num">Value</th>
            {party && <th className="num">Oldest out</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={party ? 5 : 4}>No {HOLDER_LABEL[kind].toLowerCase()} holds any crates.</EmptyRow>}
          {rows.map((h) => (
            <SelectableRow key={h.holderId ?? 'yard'} selected={selected === h.holderId} onSelect={() => h.holderId && onSelect(h.holderId)} label={h.holderName}>
              <td>
                {h.holderName}
                {h.limit !== null && <div className="cell-sub">Limit {h.limit}</div>}
              </td>
              <td className="num" data-tone={h.limit !== null && h.total > h.limit ? 'bad' : undefined}>
                {h.total}
              </td>
              <td>{h.byType.map((t) => `${t.balance} ${t.code}`).join(' · ')}</td>
              <td className="num">{formatMoney(h.value, currency)}</td>
              {party && <td className="num">{h.daysHeld !== null ? `${h.daysHeld} day${h.daysHeld === 1 ? '' : 's'}` : '—'}</td>}
            </SelectableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function describeMove(m: CrateMovement): string {
  return `${m.from.name} → ${m.to.name}`;
}

export function MovementRows({
  rows,
  timeZone,
  canWrite,
  onReverse,
  emptyText,
}: {
  rows: CrateMovement[];
  timeZone: string;
  canWrite: boolean;
  onReverse: (m: CrateMovement) => void;
  emptyText: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>From → to</th>
            <th className="num">Crates</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5}>{emptyText}</EmptyRow>}
          {rows.map((m) => (
            <tr key={m.id} data-muted={m.reversedBy || m.kind === 'correction' ? true : undefined}>
              <td>{formatDateTime(m.occurredAt, timeZone)}</td>
              <td>
                {KIND_LABEL[m.kind]}
                {(m.reference || m.notes) && <div className="cell-sub">{[m.reference, m.notes].filter(Boolean).join(' · ')}</div>}
                {m.reversedBy && <div className="cell-sub">Reversed</div>}
              </td>
              <td>{describeMove(m)}</td>
              <td className="num">
                {m.quantity} {m.crateCode}
              </td>
              <td>
                {canWrite && m.reversible && (
                  <button type="button" className="button" onClick={() => onReverse(m)}>
                    Reverse
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Dialog = { move: CrateMovementKind } | { loss: 'absorbed' | 'charge' } | 'limit' | { reverse: CrateMovement };

export function HolderPanel({
  sel,
  types,
  currency,
  today,
  timeZone,
  canWrite,
  canCharge,
  canConfigure,
  onClose,
}: {
  sel: HolderSel;
  types: CrateType[];
  currency: string;
  today: string;
  timeZone: string;
  canWrite: boolean;
  canCharge: boolean;
  canConfigure: boolean;
  onClose: () => void;
}) {
  const { data, error, isPending, refetch } = useCrateHolder(sel.kind, sel.id);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (isPending || error || !data) {
    return (
      <DetailPanel title="Crates" onClose={onClose}>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  const party = sel.kind === 'customer' || sel.kind === 'farmer';
  const close = () => setDialog(null);
  return (
    <DetailPanel title={data.holderName} onClose={onClose}>
      <KeyValues
        items={[
          ['Holds', plural(data.total)],
          ['By type', data.byType.length ? data.byType.map((t) => `${t.balance} ${t.code}`).join(' · ') : '—'],
          ['Value', formatMoney(data.value, currency)],
          ...(party
            ? ([
                ['Oldest out since', data.oldestSince ? `${formatDate(data.oldestSince)} (${data.daysHeld} days)` : '—'],
                ['Limit', data.limit !== null ? String(data.limit) : 'None'],
              ] as [string, string][])
            : []),
        ]}
      />
      {(canWrite || (canCharge && party) || (canConfigure && party)) && (
        <ActionBar>
          {canWrite && party && (
            <>
              <button type="button" className="button button-primary" onClick={() => setDialog({ move: 'returned' })}>
                Record a return
              </button>
              <button type="button" className="button" onClick={() => setDialog({ move: 'issued' })}>
                Issue crates
              </button>
            </>
          )}
          {canWrite && sel.kind === 'vehicle' && (
            <>
              <button type="button" className="button button-primary" onClick={() => setDialog({ move: 'unloaded' })}>
                Unload to yard
              </button>
              <button type="button" className="button" onClick={() => setDialog({ move: 'loaded' })}>
                Load from yard
              </button>
            </>
          )}
          {canWrite && sel.kind === 'yard' && (
            <button type="button" className="button button-primary" onClick={() => setDialog({ move: 'purchased' })}>
              Buy crates
            </button>
          )}
          {canWrite && (
            <button type="button" className="button" onClick={() => setDialog({ move: 'opening' })}>
              Opening count
            </button>
          )}
          {canCharge && party && data.total > 0 && (
            <button type="button" className="button" onClick={() => setDialog({ loss: 'charge' })}>
              Charge for lost crates
            </button>
          )}
          {canWrite && data.total > 0 && (
            <button type="button" className="button" onClick={() => setDialog({ loss: 'absorbed' })}>
              Write off lost crates
            </button>
          )}
          {canConfigure && party && (
            <button type="button" className="button" onClick={() => setDialog('limit')}>
              Set a limit
            </button>
          )}
        </ActionBar>
      )}

      {data.losses.length > 0 && (
        <>
          <h3 className="detail-subhead">Losses</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th className="num">Crates</th>
                  <th>Recovered</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.losses.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {formatDateTime(l.occurredAt, timeZone)}
                      <div className="cell-sub">{l.reason}</div>
                    </td>
                    <td className="num">
                      {l.quantity} {l.crateCode}
                    </td>
                    <td>
                      {RECOVERY_LABEL[l.recovery]}
                      {l.invoiceNumber && <div className="cell-sub">{l.invoiceNumber}</div>}
                    </td>
                    <td className="num">{Number(l.amount) ? formatMoney(l.amount, currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="detail-subhead">History</h3>
      <MovementRows rows={data.movements} timeZone={timeZone} canWrite={canWrite} onReverse={(m) => setDialog({ reverse: m })} emptyText="No crates have moved here yet." />

      {dialog !== null && typeof dialog === 'object' && 'move' in dialog && (
        <MovementDialog kind={dialog.move} holder={sel} holderName={data.holderName} types={types} today={today} currency={currency} onClose={close} />
      )}
      {dialog !== null && typeof dialog === 'object' && 'loss' in dialog && (
        <LossDialog holder={data} mode={dialog.loss} types={types} today={today} currency={currency} onClose={close} />
      )}
      {dialog === 'limit' && <LimitDialog holder={data} onClose={close} />}
      {dialog !== null && typeof dialog === 'object' && 'reverse' in dialog && <ReverseDialog movement={dialog.reverse} onClose={close} />}
    </DetailPanel>
  );
}

/** Which side the holder is on, and what else the form needs to ask for. */
function needs(kind: CrateMovementKind, holder: HolderSel | null): { party: boolean; vehicle: boolean } {
  const h = holder?.kind;
  switch (kind) {
    case 'issued':
    case 'returned':
      return { party: h !== 'customer' && h !== 'farmer', vehicle: false };
    case 'loaded':
    case 'unloaded':
      return { party: false, vehicle: h !== 'vehicle' };
    case 'delivered':
    case 'collected':
      return { party: h !== 'customer' && h !== 'farmer', vehicle: h !== 'vehicle' };
    default:
      return { party: false, vehicle: false };
  }
}

export function MovementDialog({
  kind: initialKind,
  holder,
  holderName,
  types,
  today,
  currency,
  onClose,
  tripId,
}: {
  kind: CrateMovementKind;
  holder: HolderSel | null;
  holderName?: string;
  types: CrateType[];
  today: string;
  currency: string;
  onClose: () => void;
  tripId?: string;
}) {
  const parties = useCrateParties();
  const [kind, setKind] = useState(initialKind);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [partyKind, setPartyKind] = useState<'customer' | 'farmer'>(holder?.kind === 'farmer' ? 'farmer' : 'customer');
  const [partyId, setPartyId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [reference, setReference] = useState('');
  const [cost, setCost] = useState('');
  const [paidFrom, setPaidFrom] = useState<'bank' | 'cash_on_hand'>('bank');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'crates/movements', body), CRATE_WRITES, onClose);
  const ask = needs(kind, holder);
  const active = types.filter((t) => t.isActive || kind === 'returned' || kind === 'unloaded' || kind === 'collected');
  const partyList = partyKind === 'customer' ? parties.data?.customers ?? [] : parties.data?.farmers ?? [];
  const title = `${KIND_LABEL[kind]}${holderName ? ` — ${holderName}` : ''}`;
  return (
    <FormDialog
      title={title}
      submitLabel="Record"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const lines: { crateTypeId: string; quantity: number }[] = [];
        for (const t of active) {
          const v = (counts[t.id] ?? '').trim();
          if (!v) continue;
          const n = parseWholeNumber(v, `the ${t.code} count`, 0, 100000);
          if (!n.ok) return setProblem(n.error);
          if (n.value > 0) lines.push({ crateTypeId: t.id, quantity: n.value });
        }
        if (!lines.length) return setProblem('Enter how many crates.');
        const onParty = holder && (holder.kind === 'customer' || holder.kind === 'farmer');
        const p = onParty ? { partyKind: holder!.kind, partyId: holder!.id } : ask.party ? { partyKind, partyId } : {};
        if (ask.party && !partyId) return setProblem(`Choose the ${partyKind}.`);
        const v = holder?.kind === 'vehicle' ? holder.id : ask.vehicle ? vehicleId : undefined;
        if (ask.vehicle && !vehicleId) return setProblem('Choose the vehicle.');
        const c = kind === 'purchased' && cost.trim() ? parseMoney(cost, 'the cost', true) : null;
        if (c && !c.ok) return setProblem(c.error);
        setProblem(null);
        save.mutate({
          kind,
          ...p,
          ...(kind === 'opening' && holder?.kind === 'vehicle' ? { vehicleId: holder.id } : {}),
          ...(v && kind !== 'opening' ? { vehicleId: v } : {}),
          lines,
          occurredOn,
          tripId,
          reference: optionalText(reference),
          ...(c && c.ok ? { cost: c.value, paidFrom } : {}),
        });
      }}
    >
      {holder === null && (
        <Field label="What happened">
          {(p) => (
            <select {...p} value={kind} onChange={(e) => setKind(e.target.value as CrateMovementKind)}>
              {(['issued', 'returned', 'loaded', 'unloaded', 'delivered', 'collected', 'purchased'] as const).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {ask.party && (
        <>
          <Field label="Customer or farmer">
            {(p) => (
              <select
                {...p}
                value={partyKind}
                onChange={(e) => {
                  setPartyKind(e.target.value as 'customer' | 'farmer');
                  setPartyId('');
                }}
              >
                <option value="customer">Customer</option>
                <option value="farmer">Farmer</option>
              </select>
            )}
          </Field>
          <Field label={partyKind === 'customer' ? 'Customer' : 'Farmer'}>
            {(p) => (
              <select {...p} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">Choose…</option>
                {partyList.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      {ask.vehicle && (
        <Field label="Vehicle">
          {(p) => (
            <select {...p} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Choose…</option>
              {(parties.data?.vehicles ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {active.map((t) => (
        <Field key={t.id} label={`${t.code} crates`} hint={t.name}>
          {(p) => <input {...p} inputMode="numeric" value={counts[t.id] ?? ''} onChange={(e) => setCounts({ ...counts, [t.id]: e.target.value })} />}
        </Field>
      ))}
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />}</Field>
      <Field label="Reference (optional)">{(p) => <input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      {kind === 'purchased' && (
        <>
          <Field label={`Cost in all (${currency}, optional)`} hint="Posted as crates and packaging expense">
            {(p) => <input {...p} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}
          </Field>
          {cost.trim() !== '' && (
            <Field label="Paid from">
              {(p) => (
                <select {...p} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as 'bank' | 'cash_on_hand')}>
                  <option value="bank">Bank</option>
                  <option value="cash_on_hand">Cash</option>
                </select>
              )}
            </Field>
          )}
        </>
      )}
    </FormDialog>
  );
}

function LossDialog({
  holder,
  mode,
  types,
  today,
  currency,
  onClose,
}: {
  holder: CrateHolderDetail;
  mode: 'absorbed' | 'charge';
  types: CrateType[];
  today: string;
  currency: string;
  onClose: () => void;
}) {
  const held = holder.byType;
  const [typeId, setTypeId] = useState(held[0]?.crateTypeId ?? '');
  const [quantity, setQuantity] = useState('');
  const type = types.find((t) => t.id === typeId);
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', mode === 'charge' ? 'crates/losses/charge' : 'crates/losses', body), CRATE_WRITES, onClose);
  const q = Number(quantity) || 0;
  const unit = price.trim() ? Number(price) : Number(type?.replacementCost ?? 0);
  return (
    <FormDialog
      title={`${mode === 'charge' ? 'Charge for lost crates' : 'Write off lost crates'} — ${holder.holderName}`}
      description={
        <p>
          {mode === 'charge'
            ? holder.holderKind === 'customer'
              ? 'The customer gets an invoice for the crates, with GST if the crate type has an HSN your rates tax.'
              : 'The charge comes off what the farmer is owed, oldest bill first.'
            : 'The crates come off the count; nothing is charged.'}
        </p>
      }
      submitLabel={mode === 'charge' ? 'Charge' : 'Write off'}
      tone={mode === 'charge' ? undefined : 'danger'}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const n = parseWholeNumber(quantity, 'the number of crates', 1, 100000);
        if (!n.ok) return setProblem(n.error);
        const p = mode === 'charge' && price.trim() ? parseMoney(price, 'the price', true) : null;
        if (p && !p.ok) return setProblem(p.error);
        if (reason.trim().length < 3) return setProblem('Say what happened to them.');
        setProblem(null);
        save.mutate({
          holderKind: holder.holderKind,
          holderId: holder.holderId ?? undefined,
          crateTypeId: typeId,
          quantity: n.value,
          recovery: mode,
          unitCharge: p && p.ok ? p.value : undefined,
          reason: reason.trim(),
          occurredOn,
        });
      }}
    >
      <Field label="Crate type">
        {(p) => (
          <select {...p} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {held.map((t) => (
              <option key={t.crateTypeId} value={t.crateTypeId}>
                {t.code} — holds {t.balance}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Crates lost">{(p) => <input {...p} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
      {mode === 'charge' && (
        <Field label={`Price per crate (${currency})`} hint={type ? `Blank charges the replacement cost, ${type.replacementCost}` : undefined}>
          {(p) => <input {...p} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
      )}
      <Field label="What happened" wide>
        {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />}</Field>
      {mode === 'charge' && q > 0 && unit > 0 && (
        <p className="field-note" role="status">
          {q} × {formatMoney(unit.toFixed(2), currency)} = {formatMoney((q * unit).toFixed(2), currency)} before any GST
        </p>
      )}
    </FormDialog>
  );
}

function LimitDialog({ holder, onClose }: { holder: CrateHolderDetail; onClose: () => void }) {
  const [max, setMax] = useState(holder.limit !== null ? String(holder.limit) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'crates/limits', body), [KEYS.crates], onClose);
  return (
    <FormDialog
      title={`Crate limit — ${holder.holderName}`}
      description={<p>An alert shows when they hold more. Blank removes the limit.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const n = max.trim() ? parseWholeNumber(max, 'the limit', 0, 100000) : null;
        if (n && !n.ok) return setProblem(n.error);
        setProblem(null);
        save.mutate({ holderKind: holder.holderKind, holderId: holder.holderId, maxCrates: n && n.ok ? n.value : null });
      }}
    >
      <Field label="Most crates they may hold">{(p) => <input {...p} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
    </FormDialog>
  );
}

export function ReverseDialog({ movement, onClose }: { movement: CrateMovement; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `crates/movements/${movement.id}/reverse`, body), CRATE_WRITES, onClose);
  return (
    <FormDialog
      title="Reverse this entry"
      tone="danger"
      description={
        <p>
          {KIND_LABEL[movement.kind]}: {movement.quantity} {movement.crateCode}, {describeMove(movement)}. The crates go back where they came from; the entry stays in the history, marked
          reversed.
        </p>
      }
      submitLabel="Reverse"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) return setProblem('Say why.');
        setProblem(null);
        save.mutate({ reason: reason.trim() });
      }}
    >
      <Field label="Why" wide>
        {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
