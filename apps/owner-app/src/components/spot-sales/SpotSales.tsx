'use client';

import { useMemo, useState } from 'react';
import type { SpotPriceBand, SpotPriceException, SpotSaleRecord, SpotSaleStatus, SpotSalesSummary, SpotSettings } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useSpotSale, useVehicleStock } from '@/lib/hooks/use-spot-sales';
import { useTrips } from '@/lib/hooks/use-modules';
import { useActiveProducts } from '@/lib/hooks/use-lookups';
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { optionalText, parseDecimal, parseMoney, parseQuantity } from '@/lib/parse';

// A spot sale moves stock, receivables, the books and possibly an approval.
export const SPOT_WRITES = [KEYS.spot, KEYS.inventory, KEYS.finance, KEYS.dashboard, KEYS.approvals, KEYS.logistics];

const STATUS: Record<SpotSaleStatus, { label: string; tone: 'done' | 'attention' | 'bad' | 'muted' }> = {
  completed: { label: 'Completed', tone: 'done' },
  pending_approval: { label: 'Awaiting approval', tone: 'attention' },
  rejected: { label: 'Rejected', tone: 'bad' },
  cancelled: { label: 'Withdrawn', tone: 'muted' },
};
export const EXCEPTION_LABEL: Record<SpotPriceException, string> = {
  below_band: 'Below the price band',
  above_band: 'Above the price band',
  no_band: 'No price band',
  below_cost: 'Below cost',
};

export function SpotStatus({ status }: { status: SpotSaleStatus }) {
  return <StatusBadge status={status} tone={STATUS[status].tone} label={STATUS[status].label} />;
}

export function SummaryFigures({ s }: { s: SpotSalesSummary }) {
  return (
    <Figures
      items={[
        { label: 'Sales', value: `${s.completed}` },
        { label: 'Revenue (before GST)', value: formatMoney(s.revenue, s.currency) },
        { label: 'Margin', value: formatMoney(s.margin, s.currency), tone: Number(s.margin) < 0 ? 'bad' : undefined },
        { label: 'Cash with drivers / UPI', value: `${formatMoney(s.cash, s.currency)} / ${formatMoney(s.upi, s.currency)}` },
        { label: 'Awaiting approval', value: `${s.pending}`, tone: s.pending ? 'attention' : undefined },
      ]}
    />
  );
}

export function SalesTable({
  rows,
  currency,
  timeZone,
  selected,
  onSelect,
}: {
  rows: SpotSaleRecord[];
  currency: string;
  timeZone: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Sale</th>
            <th>Vehicle · driver</th>
            <th>What</th>
            <th className="num">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No spot sales in this period.</EmptyRow>}
          {rows.map((s) => (
            <SelectableRow key={s.id} selected={selected === s.id} onSelect={() => onSelect(s.id)} label={s.saleNumber}>
              <td>
                {s.saleNumber}
                <div className="cell-sub">{formatDateTime(s.soldAt, timeZone)}</div>
              </td>
              <td>
                {s.registrationNumber}
                <div className="cell-sub">{s.driverName}</div>
              </td>
              <td>
                {s.lines.map((l) => `${formatQuantity(l.quantity)} ${l.productName}`).join(', ')}
                {s.buyerName && <div className="cell-sub">To {s.buyerName}</div>}
              </td>
              <td className="num">
                {formatMoney(s.total ?? s.subtotal, currency)}
                <div className="cell-sub">{s.paymentMethod === 'cash' ? 'Cash' : 'UPI'}</div>
              </td>
              <td>
                <SpotStatus status={s.status} />
                {s.status === 'pending_approval' && <div className="cell-sub">Off by {formatMoney(s.exceptionValue, currency)}</div>}
              </td>
            </SelectableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalePanel({ id, currency, timeZone, userId, onClose }: { id: string; currency: string; timeZone: string; userId: string | null; onClose: () => void }) {
  const { data, error, isPending, refetch } = useSpotSale(id);
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const sync = useAction(() => apiSend<SpotSaleRecord>('POST', `spot-sales/${id}/sync`, {}), SPOT_WRITES);
  if (isPending || error || !data) {
    return (
      <DetailPanel title="Spot sale" onClose={onClose}>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  // By id: a login can be a phone or an email, the same person either way.
  const own = userId !== null && data.requestedBy === userId;
  return (
    <DetailPanel title={data.saleNumber} onClose={onClose}>
      <p>
        <SpotStatus status={data.status} />
      </p>
      <KeyValues
        items={[
          ['Sold', formatDateTime(data.soldAt, timeZone)],
          ['Vehicle', data.registrationNumber],
          ['Driver', data.driverName],
          ['Buyer', [data.buyerName ?? 'Walk-in', data.buyerPhone].filter(Boolean).join(' · ')],
          ['Paid by', data.paymentMethod === 'cash' ? 'Cash (held by the driver until the trip is reconciled)' : `UPI${data.paymentReference ? ` · ${data.paymentReference}` : ''}`],
          ['Before GST', formatMoney(data.subtotal, currency)],
          ...(data.status === 'completed'
            ? ([
                ['GST', formatMoney(data.taxTotal ?? '0', currency)],
                ['Total', formatMoney(data.total ?? '0', currency)],
                ['Cost of stock', formatMoney(data.costTotal ?? '0', currency)],
                ['Margin', formatMoney(data.margin ?? '0', currency)],
                ['Invoice', data.invoiceNumber ?? '—'],
              ] as [string, string][])
            : []),
          ...(data.closedReason ? ([['Closed', data.closedReason]] as [string, string][]) : []),
        ]}
      />
      {data.status === 'pending_approval' && (
        <>
          <p className="field-note">
            Off its price band by {formatMoney(data.exceptionValue, currency)} in all. The stock stays on the vehicle, held for this sale, until it&apos;s decided.
            {own && ' You recorded it, so someone else decides it.'}
          </p>
          <ActionBar>
            <button type="button" className="button button-primary" disabled={own} onClick={() => setDeciding(true)}>
              Approve
            </button>
            <button type="button" className="button" disabled={own} onClick={() => setDeciding(false)}>
              Reject
            </button>
            {data.approvalStatus !== 'pending' && (
              <button type="button" className="button" disabled={sync.isPending} onClick={() => sync.mutate(undefined)}>
                Apply the decision
              </button>
            )}
          </ActionBar>
        </>
      )}
      <h3 className="detail-subhead">Lines</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th>Band</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.productName}
                  {l.lots.length > 0 && <div className="cell-sub">{l.lots.length} lot{l.lots.length === 1 ? '' : 's'} at {l.lots.map((x) => x.unitCost).join(', ')}</div>}
                </td>
                <td className="num">{formatQuantity(l.quantity)}</td>
                <td className="num" data-tone={l.exception ? 'attention' : undefined}>
                  {formatMoney(l.unitPrice, currency)}
                </td>
                <td>
                  {l.bandSource === 'none' ? 'None' : `${l.bandMin ?? '—'} – ${l.bandMax ?? 'no ceiling'}${l.bandSource === 'default' ? ' (default)' : ''}`}
                  {l.exception && <div className="cell-sub">{EXCEPTION_LABEL[l.exception]}</div>}
                </td>
                <td className="num">{formatMoney(l.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deciding !== null && <DecisionDialog sale={data} approve={deciding} currency={currency} onClose={() => setDeciding(null)} />}
    </DetailPanel>
  );
}

function DecisionDialog({ sale, approve, currency, onClose }: { sale: SpotSaleRecord; approve: boolean; currency: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  const decide = useAction((body: unknown) => apiSend('POST', `spot-sales/${sale.id}/decision`, body), SPOT_WRITES, onClose);
  return (
    <FormDialog
      title={`${approve ? 'Approve' : 'Reject'} ${sale.saleNumber}`}
      tone={approve ? undefined : 'danger'}
      description={
        <p>
          {approve
            ? `The sale completes: its stock is drawn from ${sale.registrationNumber}, it's invoiced and paid, and its cost booked.`
            : 'The held stock is released. The driver can sell again at a price inside the band.'}{' '}
          Price exception: {formatMoney(sale.exceptionValue, currency)}.
        </p>
      }
      submitLabel={approve ? 'Approve' : 'Reject'}
      pending={decide.isPending}
      error={decide.error}
      onClose={onClose}
      onSubmit={() => decide.mutate({ approved: approve, note: optionalText(note) })}
    >
      <Field label="Note (optional)" wide>
        {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

/** Recording a sale the driver phoned in, from the office — the same call the driver app makes. */
export function RecordSaleDialog({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: (id: string) => void }) {
  const trips = useTrips('in_progress', 1);
  const [tripId, setTripId] = useState<string | null>(null);
  const stock = useVehicleStock(tripId);
  const [rows, setRows] = useState<Record<string, { quantity: string; price: string }>>({});
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [reference, setReference] = useState('');
  const [buyer, setBuyer] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const clientRef = useMemo(() => crypto.randomUUID(), []);
  const save = useAction((body: unknown) => apiSend<SpotSaleRecord>('POST', 'spot-sales', body), SPOT_WRITES, (s) => onDone(s.id));
  const set = (id: string, k: 'quantity' | 'price', v: string) => setRows({ ...rows, [id]: { ...(rows[id] ?? { quantity: '', price: '' }), [k]: v } });
  return (
    <FormDialog
      title="Record a spot sale"
      size="wide"
      description={<p>From the stock on a vehicle out on a trip. A price outside its band goes for approval first.</p>}
      submitLabel="Record sale"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!tripId) return setProblem('Choose the trip.');
        const lines: { productId: string; quantity: number; unitPrice: number }[] = [];
        for (const s of stock.data ?? []) {
          const r = rows[s.productId];
          if (!r || !r.quantity.trim()) continue;
          const q = parseQuantity(r.quantity, `the ${s.productName} quantity`);
          const p = parseMoney(r.price, `the ${s.productName} price`, true);
          if (!q.ok) return setProblem(q.error);
          if (!p.ok) return setProblem(p.error);
          lines.push({ productId: s.productId, quantity: q.value, unitPrice: p.value });
        }
        if (!lines.length) return setProblem('Enter what was sold.');
        if (method === 'upi' && !reference.trim()) return setProblem('Enter the UPI transaction id.');
        setProblem(null);
        save.mutate({ clientRef, tripId, lines, paymentMethod: method, paymentReference: optionalText(reference), buyerName: optionalText(buyer) });
      }}
    >
      <Field label="Trip on the road" wide>
        {(p) => (
          <select {...p} value={tripId ?? ''} onChange={(e) => setTripId(e.target.value || null)}>
            <option value="">Choose…</option>
            {(trips.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.plannedDate ? formatDate(t.plannedDate) : 'Unplanned'} · #{t.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {tripId && stock.isPending && <SkeletonLines lines={3} />}
      {tripId && stock.data && stock.data.length === 0 && <p className="field-note">Nothing is loaded on this trip&apos;s vehicle.</p>}
      {(stock.data ?? []).map((s) => (
        <div key={s.productId} className="form-wide field-pair">
          <Field label={`${s.productName} (${s.uom})`} hint={`${formatQuantity(s.sellable)} free to sell`}>
            {(p) => <input {...p} inputMode="decimal" value={rows[s.productId]?.quantity ?? ''} onChange={(e) => set(s.productId, 'quantity', e.target.value)} />}
          </Field>
          <Field
            label={`Price (${currency}/${s.uom})`}
            hint={s.band.source === 'none' ? 'No band — needs approval' : `Band ${s.band.min} – ${s.band.max ?? 'no ceiling'}`}
          >
            {(p) => <input {...p} inputMode="decimal" value={rows[s.productId]?.price ?? ''} onChange={(e) => set(s.productId, 'price', e.target.value)} />}
          </Field>
        </div>
      ))}
      <Field label="Paid by">
        {(p) => (
          <select {...p} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'upi')}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
          </select>
        )}
      </Field>
      {method === 'upi' && <Field label="UPI transaction id">{(p) => <input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>}
      <Field label="Buyer (optional)">{(p) => <input {...p} value={buyer} onChange={(e) => setBuyer(e.target.value)} />}</Field>
    </FormDialog>
  );
}

export function BandsView({ bands, settings, currency, canConfigure }: { bands: SpotPriceBand[]; settings: SpotSettings; currency: string; canConfigure: boolean }) {
  const [adding, setAdding] = useState(false);
  const [floor, setFloor] = useState(settings.defaultFloorPct);
  const [ceiling, setCeiling] = useState(settings.defaultCeilingPct);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'spot-sales/settings', body), [KEYS.spot]);
  const dirty = floor !== settings.defaultFloorPct || ceiling !== settings.defaultCeilingPct;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Lowest</th>
              <th className="num">Highest</th>
              <th>In force</th>
            </tr>
          </thead>
          <tbody>
            {bands.length === 0 && <EmptyRow colSpan={4}>No product has its own band — the default below applies.</EmptyRow>}
            {bands.map((b) => (
              <tr key={b.id} data-muted={b.effectiveTo ? true : undefined}>
                <td>
                  {b.productName}
                  {b.notes && <div className="cell-sub">{b.notes}</div>}
                </td>
                <td className="num">{formatMoney(b.minPrice, currency)}</td>
                <td className="num">{b.maxPrice ? formatMoney(b.maxPrice, currency) : 'No ceiling'}</td>
                <td>
                  {formatDate(b.effectiveFrom)} – {b.effectiveTo ? formatDate(b.effectiveTo) : 'now'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canConfigure && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Set a price band
          </button>
        </ActionBar>
      )}
      <h3 className="detail-subhead">Products without a band</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = parseDecimal(floor, 'the floor', { decimals: 2, max: 100 });
          const c = parseDecimal(ceiling, 'the ceiling', { decimals: 2, max: 500 });
          if (!f.ok) return setProblem(f.error);
          if (!c.ok) return setProblem(c.error);
          setProblem(null);
          save.mutate({ version: settings.version, defaultFloorPct: f.value, defaultCeilingPct: c.value });
        }}
      >
        <Field label="Allowed below the base price (%)">
          {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={floor} onChange={(e) => setFloor(e.target.value)} />}
        </Field>
        <Field label="Allowed above the base price (%)">
          {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />}
        </Field>
        {canConfigure && (
          <div className="form-wide action-bar" style={{ marginTop: 0 }}>
            <button type="submit" className="button button-primary" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {problem || save.error ? <span className="form-error">{problem ?? (save.error as Error).message}</span> : null}
          </div>
        )}
      </form>
      <p className="footnote">
        A price outside the band, or below what the stock cost, needs approval — by someone other than whoever recorded the sale, within their role&apos;s limit for spot-sale
        prices. A product with no band and no base price always needs approval.
      </p>
      {adding && <BandDialog onClose={() => setAdding(false)} currency={currency} />}
    </>
  );
}

function BandDialog({ currency, onClose }: { currency: string; onClose: () => void }) {
  const products = useActiveProducts();
  const [productId, setProductId] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [from, setFrom] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'spot-sales/price-bands', body), [KEYS.spot], onClose);
  return (
    <FormDialog
      title="Set a price band"
      description={<p>The product&apos;s current band ends the day before this one starts.</p>}
      submitLabel="Save band"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const lo = parseMoney(min, 'the lowest price', true);
        const hi = max.trim() ? parseMoney(max, 'the highest price', true) : null;
        if (!productId) return setProblem('Choose the product.');
        if (!lo.ok) return setProblem(lo.error);
        if (hi && !hi.ok) return setProblem(hi.error);
        if (!from) return setProblem('Choose the date it starts.');
        setProblem(null);
        save.mutate({ productId, minPrice: lo.value, maxPrice: hi && hi.ok ? hi.value : undefined, effectiveFrom: from, notes: optionalText(notes) });
      }}
    >
      <Field label="Product">
        {(p) => (
          <select {...p} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Choose…</option>
            {products.records.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Lowest price (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />}</Field>
      <Field label={`Highest price (${currency}, optional)`}>{(p) => <input {...p} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
      <Field label="Starts on">{(p) => <input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      <Field label="Notes (optional)" wide>
        {(p) => <input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
