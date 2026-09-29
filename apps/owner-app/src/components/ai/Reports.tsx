'use client';

import { useState } from 'react';
import type { AiRecommendationType, AiScorecard, AiSettings, CustomerProfitReport, PlacePin } from '@morbeez/shared-types';
import { Field } from '@/components/ui/Form';
import { EmptyRow, Figures } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatMoney } from '@/lib/format';
import { parseDecimal } from '@/lib/parse';
import { TYPE_LABEL } from './Suggestions';

const pct = (x: number | null) => (x === null ? '—' : `${x}%`);

export function ProfitView({ report }: { report: CustomerProfitReport }) {
  const c = report.currency;
  const t = report.totals;
  return (
    <>
      <Figures
        items={[
          { label: 'Revenue (before GST)', value: formatMoney(t.revenue, c) },
          { label: 'Gross margin', value: formatMoney(t.grossMargin, c) },
          { label: 'Delivery and credit costs', value: formatMoney((Number(t.deliveryCost) + Number(t.creditCost)).toFixed(2), c) },
          { label: 'Contribution', value: formatMoney(t.contribution, c), tone: Number(t.contribution) < 0 ? 'bad' : undefined },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Revenue</th>
              <th className="num">Gross margin</th>
              <th className="num">Delivery</th>
              <th className="num">Waiting to be paid</th>
              <th className="num">Crates lost</th>
              <th className="num">Contribution</th>
              <th className="num">Pays in</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && <EmptyRow colSpan={8}>No customer invoices in this period.</EmptyRow>}
            {report.rows.map((r) => (
              <tr key={r.customerId}>
                <td>
                  {r.customerName}
                  <div className="cell-sub">{r.invoices} invoices</div>
                </td>
                <td className="num">{formatMoney(r.revenue, c)}</td>
                <td className="num">
                  {formatMoney(r.grossMargin, c)}
                  <div className="cell-sub">{pct(r.grossMarginPct)}</div>
                </td>
                <td className="num">{formatMoney(r.deliveryCost, c)}</td>
                <td className="num">{formatMoney(r.creditCost, c)}</td>
                <td className="num">{Number(r.crateLossesAbsorbed) ? formatMoney(r.crateLossesAbsorbed, c) : '—'}</td>
                <td className="num strong" data-tone={Number(r.contribution) < 0 ? 'bad' : undefined}>
                  {formatMoney(r.contribution, c)}
                  <div className="cell-sub">{pct(r.contributionPct)}</div>
                </td>
                <td className="num" data-tone={r.averageDaysToPay !== null && r.averageDaysToPay > r.paymentTermsDays + 7 ? 'attention' : undefined}>
                  {r.averageDaysToPay === null ? '—' : `${r.averageDaysToPay} d`}
                  <div className="cell-sub">terms {r.paymentTermsDays} d</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Contribution is revenue less the cost of the goods, the customer&apos;s share of the trips that served them (by kg delivered), the cost of the money tied up while
        they paid (at {Number(report.costOfCapitalPct)}% a year), and crates they lost that were written off — plus any late-payment charges and crate charges they paid.
      </p>
    </>
  );
}

export function ScorecardView({ card }: { card: AiScorecard }) {
  const b = card.buying;
  const w = (x: number | null) => (x === null ? '—' : `${Math.round(x * 1000) / 10}%`);
  return (
    <>
      <Figures
        items={[
          { label: 'Buying forecast error (backtest, 28 days)', value: w(b.backtest.wape) },
          { label: 'Error when you followed it', value: w(b.wapeFollowed) },
          { label: 'Error when you didn’t', value: w(b.wapeNotFollowed) },
          { label: 'Days within 10% of what sold', value: `${b.withinTenPct} of ${b.scored}` },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Suggestion</th>
              <th className="num">Shown</th>
              <th className="num">Used as is</th>
              <th className="num">Changed</th>
              <th className="num">Dismissed</th>
              <th className="num">Expired</th>
              <th className="num">Open</th>
            </tr>
          </thead>
          <tbody>
            {card.byType.length === 0 && <EmptyRow colSpan={7}>No suggestions in the last 4 weeks.</EmptyRow>}
            {card.byType.map((t) => (
              <tr key={t.type}>
                <td>{TYPE_LABEL[t.type]}</td>
                <td className="num">{t.shown}</td>
                <td className="num">{t.accepted}</td>
                <td className="num">{t.modified}</td>
                <td className="num">{t.dismissed}</td>
                <td className="num">{t.expired}</td>
                <td className="num">{t.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Buying error is the gap between forecast and what actually sold, as a share of what sold (lower is better). The backtest re-runs today&apos;s method on each of the last
        28 days across {b.backtest.products} products{b.backtest.bias !== null ? `; it ran ${b.backtest.bias > 0 ? 'high' : 'low'} by ${w(Math.abs(b.backtest.bias))}` : ''}.
        {card.pricing.realizedVsSuggestedPct !== null && ` Prices you took were realized ${card.pricing.realizedVsSuggestedPct}% from the suggestion on the day.`}
      </p>
    </>
  );
}

const TYPES: AiRecommendationType[] = ['procurement', 'pricing', 'logistics_route', 'logistics_load', 'customer_terms', 'exception'];

export function AiSettingsView({ settings, canConfigure }: { settings: AiSettings; canConfigure: boolean }) {
  const [f, setF] = useState({
    margin: String(Number(settings.targetMarginPct)),
    step: String(Number(settings.maxPriceMovePct)),
    minc: String(Number(settings.minCustomerMarginPct)),
    coc: String(Number(settings.costOfCapitalPct)),
    km: String(Number(settings.defaultCostPerKm)),
    off: settings.disabledTypes,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'ai/settings', body), [KEYS.ai]);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const fields = [
          parseDecimal(f.margin, 'the target margin', { decimals: 2, max: 200 }),
          parseDecimal(f.step, 'the price step', { decimals: 2, positive: true, max: 100 }),
          parseDecimal(f.minc.replace('-', ''), 'the customer floor', { decimals: 2, max: 100 }),
          parseDecimal(f.coc, 'the cost of capital', { decimals: 2, max: 60 }),
          parseDecimal(f.km, 'the cost per km', { decimals: 2, positive: true }),
        ];
        const bad = fields.find((x) => !x.ok);
        if (bad && !bad.ok) return setProblem(bad.error);
        setProblem(null);
        const [m, st, mc, co, k] = fields.map((x) => (x.ok ? x.value : 0));
        save.mutate({ version: settings.version, targetMarginPct: m, maxPriceMovePct: st, minCustomerMarginPct: f.minc.trim().startsWith('-') ? -mc : mc, costOfCapitalPct: co, defaultCostPerKm: k, disabledTypes: f.off });
      }}
    >
      <Field label="Target margin on cost (%)" hint="Price suggestions start here">
        {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={f.margin} onChange={(e) => set({ margin: e.target.value })} />}
      </Field>
      <Field label="Largest price move in one step (%)">
        {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={f.step} onChange={(e) => set({ step: e.target.value })} />}
      </Field>
      <Field label="Flag customers contributing under (%)">
        {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={f.minc} onChange={(e) => set({ minc: e.target.value })} />}
      </Field>
      <Field label="Cost of money tied up (% a year)">
        {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={f.coc} onChange={(e) => set({ coc: e.target.value })} />}
      </Field>
      <Field label="Running cost per km when unknown (₹)">
        {(p) => <input {...p} inputMode="decimal" disabled={!canConfigure} value={f.km} onChange={(e) => set({ km: e.target.value })} />}
      </Field>
      <fieldset className="form-wide checks" disabled={!canConfigure}>
        <legend>Suggestions switched on</legend>
        {TYPES.map((t) => (
          <label key={t}>
            <input type="checkbox" checked={!f.off.includes(t)} onChange={(e) => set({ off: e.target.checked ? f.off.filter((x) => x !== t) : [...f.off, t] })} /> {TYPE_LABEL[t]}
          </label>
        ))}
      </fieldset>
      {canConfigure && (
        <div className="form-wide action-bar" style={{ marginTop: 0 }}>
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {problem || save.error ? <span className="form-error">{problem ?? (save.error as Error).message}</span> : null}
        </div>
      )}
    </form>
  );
}

export function PinsView({ pins, canEdit }: { pins: PlacePin[]; canEdit: boolean }) {
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Route and load suggestions need to know where places are. Paste each one&apos;s latitude and longitude from any map app (for example 18.5204, 73.8567).
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Place</th>
              <th>Map pin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pins.map((p) => (
              <PinRow key={`${p.kind}:${p.refId ?? 'depot'}`} pin={p} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PinRow({ pin, canEdit }: { pin: PlacePin; canEdit: boolean }) {
  const [text, setText] = useState(pin.latitude ? `${Number(pin.latitude)}, ${Number(pin.longitude)}` : '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'logistics/pins', body), [KEYS.ai]);
  const id = `pin-${pin.kind}-${pin.refId ?? 'depot'}`;
  return (
    <tr>
      <td>
        {pin.name}
        <div className="cell-sub">{pin.kind === 'depot' ? 'Depot' : pin.kind === 'customer' ? 'Customer' : 'Farmer'}</div>
      </td>
      <td>
        <label htmlFor={id} className="visually-hidden">
          Map pin for {pin.name}
        </label>
        <input id={id} className="pin-input" disabled={!canEdit} value={text} placeholder="latitude, longitude" onChange={(e) => setText(e.target.value)} />
        {(problem || save.error) && <div className="cell-sub" data-tone="bad">{problem ?? (save.error as Error).message}</div>}
      </td>
      <td>
        {canEdit && (
          <button
            type="button"
            className="button"
            disabled={save.isPending}
            onClick={() => {
              const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
              if (!m) return setProblem('Enter "latitude, longitude".');
              setProblem(null);
              save.mutate({ kind: pin.kind, refId: pin.refId ?? undefined, latitude: Number(Number(m[1]).toFixed(6)), longitude: Number(Number(m[2]).toFixed(6)) });
            }}
          >
            {save.isSuccess ? 'Saved' : 'Save'}
          </button>
        )}
      </td>
    </tr>
  );
}
