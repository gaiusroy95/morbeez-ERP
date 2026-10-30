'use client';

import type { PriceStanding, PricingRow } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/ListControls';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StatTiles } from '@/components/redesign/Party';
import { SuggestionCard } from '@/components/ai/Suggestions';
import { FreshButton, RunNote } from '@/components/ai/RunBar';
import { useAiPricing, useOpenSuggestions } from '@/lib/hooks/use-ai';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatQuantity, formatRate } from '@/lib/format';
import { useT } from '@/lib/i18n';

const STANDING: Record<PriceStanding, { label: string; tone: 'bad' | 'attention' | 'done' | 'muted' }> = {
  below_cost: { label: 'Below cost', tone: 'bad' },
  no_price: { label: 'No price set', tone: 'bad' },
  below_sustainable: { label: 'Below sustainable', tone: 'bad' },
  below_target: { label: 'Below target', tone: 'attention' },
  on_target: { label: 'On target', tone: 'done' },
  no_cost: { label: 'No costed stock', tone: 'muted' },
};

/**
 * AI Pricing (owner Phase 8; first mockup set, screen 23; requirements
 * Part 15): each product's price against what it costs to sell — what the
 * stock on hand cost, what spoilage usually takes (paid for, never sold),
 * delivering a kilo — the minimum sustainable price, and the target with
 * the owner's margin. The open price suggestions are acted on here as
 * anywhere: you set the price (AI System DR.3).
 */
export default function AiPricingPage() {
  const t = useT();
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const board = useAiPricing();
  const suggestions = useOpenSuggestions('pricing');

  return (
    <div className="stack">
      <PageHeader
        title="AI Pricing"
        subtitle="Each product's price against what it costs to sell: what the stock cost, what spoilage takes and delivery — then your target margin. You set the price."
        actions={<FreshButton />}
      />
      {board.isPending ? (
        <SkeletonLines lines={8} />
      ) : board.error || !board.data ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : (
        <>
          <StatTiles
            items={[
              { label: 'Below cost or sustainable', value: board.data.rows.filter((r) => ['below_cost', 'no_price', 'below_sustainable'].includes(r.standing)).length, tone: 'bad' },
              { label: 'Below target', value: board.data.rows.filter((r) => r.standing === 'below_target').length },
              { label: 'On target', value: board.data.rows.filter((r) => r.standing === 'on_target').length, tone: 'good' },
              { label: 'Delivery a kilo', value: board.data.deliveryPerKg ? formatRate(board.data.deliveryPerKg, board.data.currency) : '—' },
            ]}
          />
          <Panel title={t('Price against cost')}>
            <p className="muted run-note">
              {t('Sustainable = what the stock cost + what spoilage takes + delivery. Target adds your {pct}% margin. Delivery: {cost} over {kg} delivered, {from} – {to}.', {
                pct: Number(board.data.targetMarginPct),
                cost: formatRate(board.data.deliveryWindow.cost, board.data.currency),
                kg: formatQuantity(board.data.deliveryWindow.kg, 'kg'),
                from: formatDate(board.data.deliveryWindow.from),
                to: formatDate(board.data.deliveryWindow.to),
              })}
            </p>
            <div className="table-wrap">
              <table className="table pricing-table">
                <thead>
                  <tr>
                    <th>{t('Product')}</th>
                    <th className="num">{t('Today')}</th>
                    <th className="num">{t('Stock cost')}</th>
                    <th className="num">{t('Spoilage')}</th>
                    <th className="num">{t('Delivery')}</th>
                    <th className="num">{t('Sustainable')}</th>
                    <th className="num">{t('Target')}</th>
                    <th className="num">{t('Margin')}</th>
                    <th>{t('Last 14 days')}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.data.rows.map((r) => (
                    <PriceRow key={r.productId} r={r} currency={board.data.currency} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      <Panel title={t('Price suggestions')}>
        <RunNote type="pricing" />
        {suggestions.isPending ? (
          <SkeletonLines lines={4} />
        ) : suggestions.error || !suggestions.data ? (
          <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />
        ) : suggestions.data.items.length === 0 ? (
          <p className="muted">{t('No price to change right now.')}</p>
        ) : (
          <div className="suggestions">
            {suggestions.data.items.map((r) => (
              <div key={r.id} id={`suggestion-${r.id}`}>
                <SuggestionCard rec={r} currency={board.data?.currency ?? 'INR'} timeZone={timeZone} permissions={session?.permissions ?? []} />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function PriceRow({ r, currency }: { r: PricingRow; currency: string }) {
  const t = useT();
  const s = STANDING[r.standing];
  const money = (v: string | null | undefined) => (v ? formatRate(v, currency) : '—');
  return (
    <tr data-standing={r.standing}>
      <th scope="row">
        {r.name}
        <span className="muted small-block">{r.stockQty ? t('{qty} in stock', { qty: formatQuantity(r.stockQty, r.uom) }) : t('None in stock')}</span>
        <span className="price-standing">
          <StatusBadge status={r.standing} tone={s.tone} label={s.label} />
          {r.suggestionId && <a href={`#suggestion-${r.suggestionId}`}>{t('See the suggestion')}</a>}
        </span>
      </th>
      <td className="num">{r.currentPrice ? `${money(r.currentPrice)}/${r.uom}` : '—'}</td>
      <td className="num">{money(r.unitCost)}</td>
      <td className="num">
        {r.buildUp ? money(r.buildUp.spoilage) : '—'}
        {r.buildUp && r.buildUp.shrinkRate > 0 && <span className="muted small-block">{Math.round(r.buildUp.shrinkRate * 1000) / 10}%</span>}
      </td>
      <td className="num">{r.buildUp?.delivery ? money(r.buildUp.delivery) : '—'}</td>
      <td className="num">
        <strong>{money(r.buildUp?.sustainable)}</strong>
      </td>
      <td className="num">{money(r.buildUp?.target)}</td>
      <td className="num">{r.marginPct === null ? '—' : `${r.marginPct}%`}</td>
      <td>{r.realized ? `${money(r.realized.low)} – ${money(r.realized.high)}` : '—'}</td>
    </tr>
  );
}
