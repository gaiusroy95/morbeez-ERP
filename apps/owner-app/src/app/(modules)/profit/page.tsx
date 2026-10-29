'use client';

import { useState } from 'react';
import { RangeTabs, useRangeText } from '@/components/redesign/Range';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { useProfitInsights, type Range } from '@/lib/hooks/use-money-stock';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';

function Change({ percent }: { percent: string | null }) {
  const t = useT();
  if (percent === null) return null;
  const value = Number(percent);
  return (
    <span className="profit-change" data-tone={value < 0 ? 'bad' : 'good'} title={t('Compared with the previous period')}>
      <Icon name={value < 0 ? 'arrowDown' : 'arrowUp'} size={13} />
      {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%
    </span>
  );
}

/**
 * Profit & Insights (client design V1.1, screen 16): the period's revenue,
 * total cost, net profit and margin — the books' own figures — and product
 * by product, sales against what the kilos sold cost.
 */
export default function ProfitPage() {
  const t = useT();
  const { data: session } = useSession();
  const [range, setRange] = useState<Range>({ name: 'today' });
  const { data, error, isPending, refetch } = useProfitInsights(range);
  const text = useRangeText();
  const money = (v: string) => formatMoney(v, data?.range.currency ?? 'INR');

  if (session && !hasPermission(session, 'dashboard:profit')) {
    return (
      <div className="panel placeholder">
        <strong>{t('Your role doesn’t include profit figures.')}</strong>
      </div>
    );
  }

  const best = Math.max(0, ...(data?.products ?? []).map((p) => Number(p.profit)));
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1 className="page-title visually-hidden">{t('Profit & Insights')}</h1>
      <RangeTabs range={range} onChange={setRange} />
      {error ? (
        <div className="panel">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : !data ? (
        isPending && range.name !== 'custom' ? <SkeletonLines lines={4} height={56} /> : <p className="muted">{t('Choose the dates.')}</p>
      ) : (
        <>
          <p className="range-text">{text(data.range)}</p>
          <div className="profit-tiles">
            <div className="profit-tile">
              <span className="profit-tile-label">{t('Revenue')}</span>
              <span className="profit-tile-value">
                {money(data.revenue)} <Change percent={data.revenueChangePercent} />
              </span>
            </div>
            <div className="profit-tile">
              <span className="profit-tile-label">{t('Total Cost')}</span>
              <span className="profit-tile-value">{money(data.totalCost)}</span>
            </div>
            <div className="profit-tile" data-tone={Number(data.netProfit) < 0 ? 'bad' : 'good'}>
              <span className="profit-tile-label">{t('Net Profit')}</span>
              <span className="profit-tile-value profit-tile-big">{money(data.netProfit)}</span>
            </div>
            <div className="profit-tile" data-tone={Number(data.netProfit) < 0 ? 'bad' : 'good'}>
              <span className="profit-tile-label">{t('Margin')}</span>
              <span className="profit-tile-value profit-tile-big">{data.marginPercent === null ? '—' : `${data.marginPercent}%`}</span>
            </div>
          </div>
          <h2 className="section-title">{t('Product-wise Profit')}</h2>
          {data.products.length === 0 ? (
            <div className="list-empty">{t('Nothing sold in this period.')}</div>
          ) : (
            <ul className="product-profit" data-updating={isPending || undefined}>
              {data.products.map((p) => {
                const profit = Number(p.profit);
                return (
                  <li key={p.productId}>
                    <span className="product-profit-name">{p.product}</span>
                    <span className="product-profit-bar" aria-hidden="true">
                      <span data-tone={profit < 0 ? 'bad' : undefined} style={{ width: `${best > 0 ? Math.max(2, (Math.abs(profit) / best) * 100) : 2}%` }} />
                    </span>
                    <span className="product-profit-amount" data-tone={profit < 0 ? 'bad' : undefined}>
                      {money(p.profit)}
                    </span>
                    <span className="product-profit-margin">{p.marginPercent === null ? '—' : `${p.marginPercent}%`}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="footnote">{t('Profit by product is sales before GST less what the kilos sold cost; the margin is that profit on the sales.')}</p>
        </>
      )}
    </div>
  );
}
