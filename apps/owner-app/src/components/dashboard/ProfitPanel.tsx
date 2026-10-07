'use client';

import type { DashboardProfit } from '@morbeez/shared-types';
import { useDashboardProfit } from '@/lib/hooks/use-dashboard';
import { formatMoney } from '@/lib/format';
import { ErrorState, Panel, SkeletonLines } from '../ui/Panel';
import { useT } from '@/lib/i18n';

interface BridgeStep {
  label: string;
  amount: string;
  kind: 'revenue' | 'cost' | 'result';
  // Bar geometry as fractions of revenue (presentation only).
  start: number;
  end: number;
}

// Revenue → minus cost of goods → gross profit → minus trip expenses →
// contribution, drawn as a bridge. Falls back to plain magnitude bars when
// a step goes negative, where a bridge would have to draw off the chart.
function buildBridge(profit: DashboardProfit): BridgeStep[] {
  const revenue = Number(profit.costedRevenue);
  const gross = Number(profit.grossProfit);
  const contribution = Number(profit.operatingContribution);
  const steps = [
    { label: 'Revenue (costed)', amount: profit.costedRevenue, kind: 'revenue' as const },
    { label: 'Cost of goods', amount: profit.costOfGoods, kind: 'cost' as const },
    { label: 'Gross profit', amount: profit.grossProfit, kind: 'result' as const },
    { label: 'Trip expenses', amount: profit.tripExpenses, kind: 'cost' as const },
    { label: 'Contribution', amount: profit.operatingContribution, kind: 'result' as const },
  ];

  if (revenue > 0 && gross >= 0 && contribution >= 0) {
    const g = gross / revenue;
    const k = contribution / revenue;
    const spans: [number, number][] = [
      [0, 1],
      [g, 1],
      [0, g],
      [k, g],
      [0, k],
    ];
    return steps.map((step, i) => ({ ...step, start: spans[i][0], end: spans[i][1] }));
  }

  const max = Math.max(...steps.map((s) => Math.abs(Number(s.amount))), 1);
  return steps.map((step) => ({ ...step, start: 0, end: Math.abs(Number(step.amount)) / max }));
}

function Bridge({ profit, currency }: { profit: DashboardProfit; currency: string }) {
  const t = useT();
  return (
    <div className="bridge">
      {buildBridge(profit).map((step) => {
        const negative = Number(step.amount) < 0;
        const kind = step.kind === 'result' && negative ? 'loss' : step.kind;
        return (
          <div key={step.label} className="bridge-row">
            <span className="bridge-label">{t(step.label)}</span>
            <span className="bridge-track" aria-hidden="true">
              <span
                className="bridge-bar"
                data-kind={kind}
                style={{ left: `${step.start * 100}%`, width: `${Math.max((step.end - step.start) * 100, 0.5)}%` }}
              />
            </span>
            <span className="bridge-amount">
              {step.kind === 'cost' ? '−' : ''}
              {formatMoney(step.amount, currency)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ByProduct({ profit, currency }: { profit: DashboardProfit; currency: string }) {
  const t = useT();
  if (profit.byProduct.length === 0) {
    return <p className="state">{t('No deliveries in this period yet.')}</p>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('Product')}</th>
            <th scope="col" className="align-right">{t('Revenue')}</th>
            <th scope="col" className="align-right">{t('Gross profit')}</th>
            <th scope="col" className="align-right">{t('Margin')}</th>
          </tr>
        </thead>
        <tbody>
          {profit.byProduct.map((line) => {
            const margin = line.grossMarginPercent === null ? null : Number(line.grossMarginPercent);
            return (
              <tr key={line.productId}>
                <td>
                  {line.productName}
                  {line.uncostedLines > 0 && (
                    <span className="panel-meta" title={t('Some deliveries of this product have no costed lot')}>
                      {' '}
                      · {t('partly uncosted')}
                    </span>
                  )}
                </td>
                <td className="align-right">{formatMoney(line.revenue, currency)}</td>
                <td className="align-right">{formatMoney(line.grossProfit, currency)}</td>
                <td className="align-right">
                  {margin === null ? (
                    '—'
                  ) : (
                    <span className="margin-cell">
                      <span className="margin-meter" aria-hidden="true">
                        <span
                          data-tone={margin < 0 ? 'bad' : undefined}
                          style={{ width: `${Math.min(Math.abs(margin), 100)}%` }}
                        />
                      </span>
                      {line.grossMarginPercent}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProfitPanel({ days, currency }: { days: number; currency: string }) {
  const { data, error, isPending, refetch } = useDashboardProfit(days, true);
  const t = useT();

  return (
    <Panel title="Profit" meta="From deliveries in this period · operational estimate">
      {isPending ? (
        <SkeletonLines lines={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="profit-headline">
            <div>
              <div className="profit-figure-label">{t('Gross profit')}</div>
              <div className="profit-figure-value" data-tone={Number(data.grossProfit) < 0 ? 'bad' : undefined}>
                {formatMoney(data.grossProfit, currency)}
              </div>
            </div>
            <div>
              <div className="profit-figure-label">{t('Gross margin')}</div>
              <div className="profit-figure-value">
                {data.grossMarginPercent === null ? '—' : `${data.grossMarginPercent}%`}
              </div>
            </div>
            <div>
              <div className="profit-figure-label">{t('After trip expenses')}</div>
              <div
                className="profit-figure-value"
                data-tone={Number(data.operatingContribution) < 0 ? 'bad' : undefined}
              >
                {formatMoney(data.operatingContribution, currency)}
              </div>
            </div>
          </div>

          <div className="profit-layout">
            <div>
              <Bridge profit={data} currency={currency} />
              <p className="footnote">
                {t('Cost of goods uses the actual lots reserved for each delivered order. This is an operating view, not the ledger.')}
                {Number(data.uncostedRevenue) > 0 &&
                  ' ' +
                    t('{amount} of revenue has no costed lot yet and is left out of the margin rather than counted as free.', {
                      amount: formatMoney(data.uncostedRevenue, currency),
                    })}
              </p>
            </div>
            <ByProduct profit={data} currency={currency} />
          </div>
        </>
      )}
    </Panel>
  );
}
