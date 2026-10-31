'use client';

import { useState } from 'react';
import type { FastagEntryKind, FastagView } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow } from '@/components/ui/ListControls';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useFastag } from '@/lib/hooks/use-fleet';
import { formatDate, formatMoney } from '@/lib/format';
import { firstError, optionalText, parseMoney } from '@/lib/parse';

// As Vehicles' own writes: the fleet views, and the money views a recharge or charge posts to.
const FLEET_WRITES = [KEYS.fleet, KEYS.lookupVehicles, KEYS.finance, KEYS.dashboard];

const ENTRY_LABEL: Record<FastagEntryKind, string> = { recharge: 'Recharge', toll: 'Trip toll', charge: 'Charge' };

/**
 * A vehicle's FASTag: what's on it, every recharge and everything taken off
 * it — a driver's toll or parking paid by tag on a trip, or a charge on the
 * tag's statement no trip recorded. The balance is what those add up to; it
 * is an asset on the books, and none of it is the driver's cash.
 */
export function FastagSection({ vehicleId, currency, today, canWrite }: { vehicleId: string; currency: string; today: string; canWrite: boolean }) {
  const tag = useFastag(vehicleId);
  const [dialog, setDialog] = useState<'tag' | 'recharge' | 'charge' | null>(null);
  const close = () => setDialog(null);
  return (
    <>
      <h3 className="detail-subhead">FASTag</h3>
      {tag.isPending ? (
        <SkeletonLines lines={2} />
      ) : tag.error || !tag.data ? (
        <ErrorState error={tag.error} onRetry={() => tag.refetch()} />
      ) : (
        <>
          <div className="fastag-balance" data-low={tag.data.low}>
            <strong>{formatMoney(tag.data.balance, currency)}</strong>
            <span className="muted">
              {tag.data.tagId
                ? `Tag ${tag.data.tagId}${tag.data.issuer ? ` · ${tag.data.issuer}` : ''} · warn below ${formatMoney(tag.data.lowBalance ?? '0', currency)}`
                : 'No tag recorded'}
            </span>
            {tag.data.low && <StatusBadge status="low" tone="bad" label="Recharge needed" />}
          </div>
          {canWrite && (
            <ActionBar>
              {tag.data.tagId && (
                <button type="button" className="button button-primary" onClick={() => setDialog('recharge')}>
                  Recharge
                </button>
              )}
              {tag.data.tagId && (
                <button type="button" className="button" onClick={() => setDialog('charge')}>
                  Record a charge
                </button>
              )}
              <button type="button" className="button" onClick={() => setDialog('tag')}>
                {tag.data.tagId ? 'Edit tag' : 'Add the tag'}
              </button>
            </ActionBar>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {tag.data.entries.length === 0 && <EmptyRow colSpan={3}>Nothing on the tag yet.</EmptyRow>}
                {tag.data.entries.slice(0, 15).map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.occurredOn)}</td>
                    <td>
                      {ENTRY_LABEL[e.kind]}
                      {e.tripNumber ? ` — ${e.tripNumber}` : ''}
                      {(e.notes || e.reference) && e.kind !== 'toll' && <div className="cell-sub">{[e.notes, e.reference].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className="num">{formatMoney(e.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dialog === 'tag' && <TagDialog tag={tag.data} currency={currency} onClose={close} />}
          {dialog === 'recharge' && <RechargeDialog tag={tag.data} currency={currency} today={today} onClose={close} />}
          {dialog === 'charge' && <ChargeDialog tag={tag.data} currency={currency} today={today} onClose={close} />}
        </>
      )}
    </>
  );
}

function TagDialog({ tag, currency, onClose }: { tag: FastagView; currency: string; onClose: () => void }) {
  const [f, setF] = useState({ tagId: tag.tagId ?? '', issuer: tag.issuer ?? '', lowBalance: tag.lowBalance ? String(Number(tag.lowBalance)) : '500' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', `fleet/vehicles/${tag.vehicleId}/fastag`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`FASTag — ${tag.registrationNumber}`}
      description={<p>The balance isn’t typed in: it’s what the recharges and tolls add up to.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const low = parseMoney(f.lowBalance, 'the warning balance', false);
        if (!f.tagId.trim()) return setProblem('Enter the tag’s number.');
        if (!low.ok) return setProblem(low.error);
        setProblem(null);
        save.mutate({ tagId: f.tagId.trim(), issuer: optionalText(f.issuer) ?? null, lowBalance: low.value });
      }}
    >
      <Field label="Tag number" hint="As on the tag’s statement">
        {(p) => <input {...p} value={f.tagId} maxLength={40} onChange={(e) => set({ tagId: e.target.value })} />}
      </Field>
      <Field label="Issued by (optional)">{(p) => <input {...p} value={f.issuer} maxLength={60} placeholder="Bank or wallet" onChange={(e) => set({ issuer: e.target.value })} />}</Field>
      <Field label={`Warn me below (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.lowBalance} onChange={(e) => set({ lowBalance: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function RechargeDialog({ tag, currency, today, onClose }: { tag: FastagView; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({ rechargedOn: today, amount: '', reference: '', paidFrom: 'bank' as 'bank' | 'cash_on_hand' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `fleet/vehicles/${tag.vehicleId}/fastag/recharges`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Recharge FASTag — ${tag.registrationNumber}`}
      description={<p>Moves the money from the bank or cash onto the tag. Now {formatMoney(tag.balance, currency)}.</p>}
      submitLabel="Record the recharge"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const amount = parseMoney(f.amount, 'the amount', true);
        const err = firstError([amount]);
        if (err || !amount.ok) return setProblem(err);
        setProblem(null);
        save.mutate({ amount: amount.value, rechargedOn: f.rechargedOn, paidFrom: f.paidFrom, reference: optionalText(f.reference) });
      }}
    >
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={f.rechargedOn} onChange={(e) => set({ rechargedOn: e.target.value })} />}</Field>
      <Field label={`Amount (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
      <Field label="Paid from">
        {(p) => (
          <select {...p} value={f.paidFrom} onChange={(e) => set({ paidFrom: e.target.value as 'bank' | 'cash_on_hand' })}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash</option>
          </select>
        )}
      </Field>
      <Field label="Reference (optional)">{(p) => <input {...p} value={f.reference} maxLength={80} onChange={(e) => set({ reference: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function ChargeDialog({ tag, currency, today, onClose }: { tag: FastagView; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({ chargedOn: today, amount: '', notes: '', reference: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `fleet/vehicles/${tag.vehicleId}/fastag/charges`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Charge on the FASTag — ${tag.registrationNumber}`}
      description={<p>Something on the tag’s statement no trip recorded — a toll the driver didn’t note, the bank’s fee. Posted to transport tolls.</p>}
      submitLabel="Record the charge"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const amount = parseMoney(f.amount, 'the amount', true);
        if (!amount.ok) return setProblem(amount.error);
        if (f.notes.trim().length < 3) return setProblem('Say what it was, as on the statement.');
        setProblem(null);
        save.mutate({ amount: amount.value, chargedOn: f.chargedOn, notes: f.notes.trim(), reference: optionalText(f.reference) });
      }}
    >
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={f.chargedOn} onChange={(e) => set({ chargedOn: e.target.value })} />}</Field>
      <Field label={`Amount (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
      <Field label="What it was" wide>{(p) => <input {...p} value={f.notes} maxLength={200} placeholder="Walayar toll plaza, 28 Oct" onChange={(e) => set({ notes: e.target.value })} />}</Field>
      <Field label="Reference (optional)">{(p) => <input {...p} value={f.reference} maxLength={80} onChange={(e) => set({ reference: e.target.value })} />}</Field>
    </FormDialog>
  );
}
