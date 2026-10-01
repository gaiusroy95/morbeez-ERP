'use client';

import { useState } from 'react';
import type { AiRecommendation, AiRecommendationType } from '@morbeez/shared-types';
import { AI_DECIDE_PERMISSION } from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useActiveDrivers, useActiveFarmers } from '@/lib/hooks/use-lookups';
import { formatDateTime, formatMoney } from '@/lib/format';
import { optionalText, parseDecimal, parseMoney, parseQuantity, parseWholeNumber } from '@/lib/parse';
import { displayLogin } from '@/lib/phone';

// Acting on a suggestion is the owner's own action: these dialogs call the
// ordinary endpoints with the owner's session, then record what was done
// against the suggestion (AI System DR.3, DR.4). The AI itself changes nothing.
const WRITES = [KEYS.ai, KEYS.procurement, KEYS.logistics, KEYS.customers, KEYS.spot, KEYS.inventory, KEYS.finance, KEYS.dashboard];

export const TYPE_LABEL: Record<AiRecommendationType, string> = {
  procurement: 'Buying',
  pricing: 'Price',
  logistics_route: 'Route',
  logistics_load: 'Load',
  customer_terms: 'Customer',
  exception: 'Worth a look',
};
const CONFIDENCE: Record<AiRecommendation['confidence'], { label: string; tone: 'done' | 'attention' | 'muted' }> = {
  solid: { label: 'Solid', tone: 'done' },
  rough_guide: { label: 'Rough guide', tone: 'attention' },
  early_estimate: { label: 'Early estimate', tone: 'muted' },
};
const DECISION_LABEL = { accepted: 'Accepted', modified: 'Changed', dismissed: 'Dismissed', expired: 'Expired' } as const;

type P = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function record(id: string, body: unknown) {
  return apiSend('POST', `ai/recommendations/${id}/decision`, body);
}

export function SuggestionCard({ rec, currency, timeZone, permissions }: { rec: AiRecommendation; currency: string; timeZone: string; permissions: string[] }) {
  const [dialog, setDialog] = useState<'act' | 'dismiss' | null>(null);
  const canDecide = permissions.includes(AI_DECIDE_PERMISSION[rec.type]);
  const c = CONFIDENCE[rec.confidence];
  const review = rec.proposal.action === 'review' || rec.proposal.action === 'review_customer';
  return (
    <article className="suggestion" data-type={rec.type} aria-labelledby={`s-${rec.id}`}>
      <header className="suggestion-head">
        <span className="suggestion-type">{TYPE_LABEL[rec.type]}</span>
        <StatusBadge status={rec.confidence} tone={c.tone} label={c.label} />
        {rec.status === 'open' ? (
          <span className="suggestion-when">Until {formatDateTime(rec.expiresAt, timeZone)}</span>
        ) : (
          <span className="suggestion-when">
            {DECISION_LABEL[rec.status as keyof typeof DECISION_LABEL]}
            {rec.decision?.decidedByEmail ? ` by ${displayLogin(rec.decision.decidedByEmail)}` : ''}
            {rec.decision?.reason ? ` — ${rec.decision.reason}` : ''}
          </span>
        )}
      </header>
      <h3 id={`s-${rec.id}`} className="suggestion-title">{rec.title}</h3>
      <p className="suggestion-why">{rec.explanation}</p>
      <dl className="evidence">
        {rec.evidence.map((e, i) => (
          <div key={i}>
            <dt>{e.fact}</dt>
            <dd>
              {e.value}
              {e.source?.label ? <span className="evidence-src"> · {e.source.label}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <footer className="suggestion-foot">
        {rec.expectedImpact && <span className="suggestion-impact">{rec.type === 'procurement' ? 'Worth' : 'At stake'} {formatMoney(rec.expectedImpact, currency)}</span>}
        {rec.status === 'open' && canDecide && (
          <ActionBar>
            <button type="button" className="button button-primary" onClick={() => setDialog('act')}>
              {review ? 'I looked into it' : 'Use this…'}
            </button>
            <button type="button" className="button" onClick={() => setDialog('dismiss')}>
              {review ? 'Not useful' : 'Dismiss'}
            </button>
          </ActionBar>
        )}
        {rec.status === 'open' && !canDecide && <span className="muted">Decided by the owner</span>}
      </footer>
      {dialog === 'dismiss' && <DismissDialog rec={rec} onClose={() => setDialog(null)} />}
      {dialog === 'act' && <ActDialog rec={rec} currency={currency} onClose={() => setDialog(null)} />}
    </article>
  );
}

const REASONS = ['I know something the data doesn’t', 'The numbers look wrong', 'Not now', 'Other'];

function DismissDialog({ rec, onClose }: { rec: AiRecommendation; onClose: () => void }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => record(rec.id, body), [KEYS.ai], onClose);
  return (
    <FormDialog
      title="Dismiss this suggestion"
      description={<p>{rec.title}. Your reason helps judge how good the suggestions are.</p>}
      submitLabel="Dismiss"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (reason === 'Other' && !note.trim()) return setProblem('Say why.');
        setProblem(null);
        save.mutate({ outcome: 'dismissed', reason: note.trim() ? `${reason}: ${note.trim()}` : reason });
      }}
    >
      <Field label="Why">
        {(p) => (
          <select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Note (optional)" wide>
        {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function ActDialog({ rec, currency, onClose }: { rec: AiRecommendation; currency: string; onClose: () => void }) {
  switch (rec.proposal.action) {
    case 'purchase_order':
      return <PurchaseOrderDialog rec={rec} currency={currency} onClose={onClose} />;
    case 'product_price':
      return <PriceDialog rec={rec} currency={currency} onClose={onClose} />;
    case 'resequence_stops':
      return <ReorderDialog rec={rec} onClose={onClose} />;
    case 'create_trip':
      return <TripDialog rec={rec} currency={currency} onClose={onClose} />;
    case 'credit_terms':
      return <TermsDialog rec={rec} onClose={onClose} />;
    default:
      return <ReviewedDialog rec={rec} onClose={onClose} />;
  }
}

function PurchaseOrderDialog({ rec, currency, onClose }: { rec: AiRecommendation; currency: string; onClose: () => void }) {
  const p = rec.proposal as unknown as P & { farmers: { farmerId: string; name: string; lastPrice: string }[] };
  const farmers = useActiveFarmers();
  const [farmerId, setFarmerId] = useState(s(p.farmerId));
  const [quantity, setQuantity] = useState(String(Number(p.quantity)));
  const [price, setPrice] = useState(p.indicativePrice ? String(Number(p.indicativePrice)) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    async (body: { farmerId: string; quantity: number; price: number }) => {
      const po = await apiSend<{ id: string }>('POST', 'procurement/purchase-orders', {
        farmerId: body.farmerId,
        lines: [{ productId: p.productId, expectedQuantity: body.quantity, indicativePrice: body.price }],
      });
      await record(rec.id, { outcome: 'acted', submitted: { quantity: body.quantity.toFixed(3), farmerId: body.farmerId }, resultRef: { kind: 'purchase_order', id: po.id } });
    },
    WRITES,
    onClose,
  );
  const options = farmers.records.length ? farmers.records.map((f) => ({ id: f.id, name: f.name })) : p.farmers.map((f) => ({ id: f.farmerId, name: f.name }));
  return (
    <FormDialog
      title={`Purchase order — ${rec.subjectName ?? 'product'}`}
      description={<p>A new purchase order, placed under your name; confirm it with the farmer as usual. Suggested {s(p.quantity)} {s(p.uom)} (expect {s(p.low)}–{s(p.high)} sold).</p>}
      submitLabel="Place purchase order"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const q = parseQuantity(quantity, 'the quantity');
        const pr = parseMoney(price, 'the price', true);
        if (!farmerId) return setProblem('Choose the farmer.');
        if (!q.ok) return setProblem(q.error);
        if (!pr.ok) return setProblem(pr.error);
        setProblem(null);
        save.mutate({ farmerId, quantity: q.value, price: pr.value });
      }}
    >
      <Field label="Farmer" hint={p.farmers[0] ? `Last bought from ${p.farmers.map((f) => f.name).join(', ')}` : undefined}>
        {(pp) => (
          <select {...pp} value={farmerId} onChange={(e) => setFarmerId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Quantity (${s(p.uom)})`}>{(pp) => <input {...pp} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
      <Field label={`Price (${currency}/${s(p.uom)})`}>{(pp) => <input {...pp} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function PriceDialog({ rec, currency, onClose }: { rec: AiRecommendation; currency: string; onClose: () => void }) {
  const p = rec.proposal as P;
  const [price, setPrice] = useState(String(Number(p.price)));
  const [band, setBand] = useState(true);
  const [min, setMin] = useState(String(Number(p.bandMin)));
  const [max, setMax] = useState(String(Number(p.bandMax)));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    async (body: { price: number; min: number | null; max: number | null }) => {
      await apiSend('PATCH', `products/${p.productId}`, { version: p.productVersion, basePrice: body.price });
      if (body.min !== null) {
        await apiSend('POST', 'spot-sales/price-bands', { productId: p.productId, minPrice: body.min, maxPrice: body.max ?? undefined, effectiveFrom: p.bandFrom, notes: 'From an AI price suggestion' });
      }
      await record(rec.id, { outcome: 'acted', submitted: { price: body.price.toFixed(2) }, resultRef: { kind: 'product', id: p.productId } });
    },
    WRITES,
    onClose,
  );
  return (
    <FormDialog
      title={`New price — ${rec.subjectName ?? 'product'}`}
      description={<p>Today {formatMoney(s(p.currentPrice), currency)}/{s(p.uom)}. The new list price applies to orders from now on.</p>}
      submitLabel="Set price"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const pr = parseMoney(price, 'the price', true);
        if (!pr.ok) return setProblem(pr.error);
        let lo: number | null = null;
        let hi: number | null = null;
        if (band) {
          const a = parseMoney(min, 'the lowest spot price', true);
          const b = parseMoney(max, 'the highest spot price', true);
          if (!a.ok) return setProblem(a.error);
          if (!b.ok) return setProblem(b.error);
          lo = a.value;
          hi = b.value;
        }
        setProblem(null);
        save.mutate({ price: pr.value, min: lo, max: hi });
      }}
    >
      <Field label={`List price (${currency}/${s(p.uom)})`}>{(pp) => <input {...pp} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
      <Field label="Spot-sale band from tomorrow">
        {(pp) => (
          <select {...pp} value={band ? 'yes' : 'no'} onChange={(e) => setBand(e.target.value === 'yes')}>
            <option value="yes">Set it too</option>
            <option value="no">Leave the band as it is</option>
          </select>
        )}
      </Field>
      {band && (
        <>
          <Field label={`Lowest a driver may charge (${currency})`}>{(pp) => <input {...pp} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />}</Field>
          <Field label={`Highest (${currency})`}>{(pp) => <input {...pp} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
        </>
      )}
    </FormDialog>
  );
}

function ReorderDialog({ rec, onClose }: { rec: AiRecommendation; onClose: () => void }) {
  const p = rec.proposal as unknown as P & { stopIds: string[]; stopNames: Record<string, string> };
  const save = useAction(
    async () => {
      await apiSend('PUT', `logistics/trips/${p.tripId}/stops/order`, { version: p.tripVersion, stopIds: p.stopIds });
      await record(rec.id, { outcome: 'acted', submitted: { stopIds: p.stopIds }, resultRef: { kind: 'trip', id: p.tripId } });
    },
    WRITES,
    onClose,
  );
  return (
    <FormDialog
      title="Reorder the trip's stops"
      description={<p>From about {s(p.currentKm)} km to {s(p.newKm)} km. The trip must still be planned.</p>}
      submitLabel="Reorder stops"
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => save.mutate(undefined)}
    >
      <ol className="form-wide stop-order">
        {p.stopIds.map((id) => (
          <li key={id}>{p.stopNames[id]}</li>
        ))}
      </ol>
    </FormDialog>
  );
}

function TripDialog({ rec, currency, onClose }: { rec: AiRecommendation; currency: string; onClose: () => void }) {
  const p = rec.proposal as unknown as P & { orderIds: string[]; orderNames: Record<string, string> };
  const drivers = useActiveDrivers();
  const [driver, setDriver] = useState('');
  const [advance, setAdvance] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    async (body: { driver: string; advance: number | undefined }) => {
      const trip = await apiSend<{ id: string }>('POST', 'logistics/trips', { vehicleId: p.vehicleId, driverEmployeeId: body.driver, advanceAmount: body.advance });
      for (const orderId of p.orderIds) await apiSend('POST', `logistics/trips/${trip.id}/stops/delivery`, { orderId });
      await record(rec.id, { outcome: 'acted', submitted: { vehicleId: p.vehicleId, orderIds: p.orderIds }, resultRef: { kind: 'trip', id: trip.id } });
    },
    WRITES,
    onClose,
  );
  return (
    <FormDialog
      title={`Plan a trip — ${rec.subjectName ?? 'vehicle'}`}
      description={<p>A planned trip with these deliveries, in this order. You choose the driver; start it from Trips when it leaves.</p>}
      submitLabel="Plan trip"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        if (!driver) return setProblem('Choose the driver.');
        const a = advance.trim() ? parseMoney(advance, 'the advance') : null;
        if (a && !a.ok) return setProblem(a.error);
        setProblem(null);
        save.mutate({ driver, advance: a && a.ok ? a.value : undefined });
      }}
    >
      <ol className="form-wide stop-order">
        {p.orderIds.map((id) => (
          <li key={id}>{p.orderNames[id]}</li>
        ))}
      </ol>
      <Field label="Driver">
        {(pp) => (
          <select {...pp} value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">Choose…</option>
            {drivers.records.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Cash advance (${currency}, optional)`}>{(pp) => <input {...pp} inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function TermsDialog({ rec, onClose }: { rec: AiRecommendation; onClose: () => void }) {
  const p = rec.proposal as unknown as P & { current: P; proposed: P };
  const [rate, setRate] = useState(s(p.proposed.financeChargeRateMonthly ?? p.current.financeChargeRateMonthly));
  const [grace, setGrace] = useState(s(p.proposed.financeChargeGraceDays ?? p.current.financeChargeGraceDays));
  const [terms, setTerms] = useState(s(p.current.paymentTermsDays));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction(
    async (body: { rate: number; grace: number; terms: number }) => {
      await apiSend('POST', `customers/${p.customerId}/credit-terms`, {
        version: p.customerVersion,
        paymentTermsDays: body.terms,
        financeChargeRateMonthly: body.rate,
        financeChargeGraceDays: body.grace,
      });
      await record(rec.id, {
        outcome: 'acted',
        submitted: { financeChargeRateMonthly: body.rate.toFixed(2), financeChargeGraceDays: body.grace },
        resultRef: { kind: 'customer', id: p.customerId },
      });
    },
    WRITES,
    onClose,
  );
  return (
    <FormDialog
      title={`Credit terms — ${rec.subjectName ?? 'customer'}`}
      description={<p>Today: {s(p.current.paymentTermsDays)}-day terms, {s(p.current.financeChargeRateMonthly)}% a month on overdue invoices after {s(p.current.financeChargeGraceDays)} days.</p>}
      submitLabel="Save terms"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const r = parseDecimal(rate, 'the monthly rate', { decimals: 2, max: 5 });
        const g = parseWholeNumber(grace, 'the grace days', 0, 90);
        const t = parseWholeNumber(terms, 'the payment terms', 0, 365);
        if (!r.ok) return setProblem(r.error);
        if (!g.ok) return setProblem(g.error);
        if (!t.ok) return setProblem(t.error);
        setProblem(null);
        save.mutate({ rate: r.value, grace: g.value, terms: t.value });
      }}
    >
      <Field label="Payment terms (days)">{(pp) => <input {...pp} inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />}</Field>
      <Field label="Late-payment charge (% a month)">{(pp) => <input {...pp} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
      <Field label="Grace before it applies (days)">{(pp) => <input {...pp} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function ReviewedDialog({ rec, onClose }: { rec: AiRecommendation; onClose: () => void }) {
  const [note, setNote] = useState('');
  const save = useAction((body: unknown) => record(rec.id, body), [KEYS.ai], onClose);
  return (
    <FormDialog
      title="Looked into it"
      description={<p>{rec.title}. Record what you found, if anything.</p>}
      submitLabel="Save"
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => save.mutate({ outcome: 'acted', reason: optionalText(note) })}
    >
      <Field label="What you found (optional)" wide>
        {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
