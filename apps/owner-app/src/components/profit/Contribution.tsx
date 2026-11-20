'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContributionLevel, ContributionReport, ContributionRow, CostAllocationSettings } from '@morbeez/shared-types';
import { apiGet, apiSend } from '@/lib/api/client';
import { useAction } from '@/lib/hooks/use-action';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatMoney, formatQuantity, formatRate } from '@/lib/format';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs } from '@/components/ui/ListControls';
import { Field, FormDialog } from '@/components/ui/Form';
import { useT } from '@/lib/i18n';

const LEVELS: { value: ContributionLevel; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'route', label: 'Route' },
  { value: 'trip', label: 'Trip' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'product', label: 'Product' },
  { value: 'customer', label: 'Customer' },
  { value: 'order', label: 'Order' },
];

const PARTS: [keyof ContributionRow, string][] = [
  ['purchase', 'Product purchase'],
  ['agent', 'Agent'],
  ['labour', 'Labour'],
  ['fuel', 'Fuel'],
  ['tolls', 'Tolls'],
  ['delivery', 'Delivery (vehicle)'],
  ['writtenOff', 'Shrinkage & rejection'],
  ['other', 'Other attributable'],
];

/**
 * True cost and contribution (Master Spec v3 P5; MS §34–36): revenue less
 * every attributable cost — the trip costs shared out as each trip closed —
 * then less the finance cost of waiting for the money. Every level adds up
 * to the business, rupee for rupee.
 */
export function Contribution({ from, to, currency }: { from: string; to: string; currency: string }) {
  const t = useT();
  const { data: session } = useSession();
  const canManage = hasPermission(session, 'finance:manage');
  const [level, setLevel] = useState<ContributionLevel>('customer');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const report = useQuery({
    queryKey: ['costing', 'contribution', level, from, to],
    queryFn: () => apiGet<ContributionReport>('costing/contribution', { level, from, to }),
  });
  const settings = useQuery({ queryKey: ['costing', 'settings'], queryFn: () => apiGet<CostAllocationSettings>('costing/settings') });
  const backfill = useAction(() => apiSend<{ costed: number }>('POST', 'costing/backfill'), [['costing']]);
  const money = (v: string) => formatMoney(v, currency);

  return (
    <section className="contribution" aria-label={t('True cost & contribution')}>
      <h2 className="section-title">{t('True cost & contribution')}</h2>
      <div className="trip-tabs">
        <FilterTabs label="Contribution level" options={LEVELS} value={level} onChange={(v) => v !== 'all' && setLevel(v as ContributionLevel)} />
      </div>
      {report.isPending ? (
        <SkeletonLines lines={4} />
      ) : report.error ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table contribution-table" aria-label={t('Contribution by {level}', { level: t(LEVELS.find((l) => l.value === level)?.label ?? '') })}>
              <thead>
                <tr>
                  <th>{t(LEVELS.find((l) => l.value === level)?.label ?? '')}</th>
                  <th className="num">{t('KG')}</th>
                  <th className="num">{t('Revenue')}</th>
                  <th className="num">{t('True cost')}</th>
                  <th className="num">{t('Finance cost')}</th>
                  <th className="num">{t('Net')}</th>
                  <th className="num">{t('Net / KG')}</th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-cell">
                      {t('Nothing invoiced in this period.')}
                    </td>
                  </tr>
                )}
                {report.data.rows.map((r) => {
                  const id = r.key ?? `none:${r.label}`;
                  const isOpen = open === id;
                  return (
                    <Fragment key={id}>
                      <tr className={r.key === null ? 'muted' : undefined}>
                        <td>
                          <button type="button" className="link-button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                            {r.key === null ? t(r.label) : level === 'order' ? `#${r.label}` : r.label}
                          </button>
                        </td>
                        <td className="num">{formatQuantity(r.kg)}</td>
                        <td className="num">{money(r.revenue)}</td>
                        <td className="num">{money(r.trueCost)}</td>
                        <td className="num">{money(r.financeCost)}</td>
                        <td className="num strong" data-tone={Number(r.netContribution) < 0 ? 'bad' : undefined}>
                          {money(r.netContribution)}
                          {r.netMarginPct !== null && <div className="cell-sub">{r.netMarginPct}%</div>}
                        </td>
                        <td className="num">{r.contributionPerKg === null ? '—' : formatRate(r.contributionPerKg, currency)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="contribution-parts">
                          <td colSpan={7}>
                            <ul className="plain-list contribution-part-list">
                              {PARTS.filter(([k]) => Number(r[k]) !== 0).map(([k, label]) => (
                                <li key={k}>
                                  <span>{t(label)}</span>
                                  <span className="num">{formatRate(String(r[k]), currency)}</span>
                                </li>
                              ))}
                              <li className="strong">
                                <span>{t('Contribution before finance')}</span>
                                <span className="num" data-tone={Number(r.operatingContribution) < 0 ? 'bad' : undefined}>
                                  {formatRate(r.operatingContribution, currency)}
                                </span>
                              </li>
                              {r.trueCostPerKg && (
                                <li>
                                  <span>{t('True cost per KG')}</span>
                                  <span className="num">{formatRate(r.trueCostPerKg, currency)}</span>
                                </li>
                              )}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="strong">
                  <td>{t('Total')}</td>
                  <td className="num">{formatQuantity(report.data.totals.kg)}</td>
                  <td className="num">{money(report.data.totals.revenue)}</td>
                  <td className="num">{money(report.data.totals.trueCost)}</td>
                  <td className="num">{money(report.data.totals.financeCost)}</td>
                  <td className="num">{money(report.data.totals.netContribution)}</td>
                  <td className="num">{report.data.totals.contributionPerKg === null ? '—' : formatRate(report.data.totals.contributionPerKg, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="footnote">
            {t('Finance cost is what was owed × the days it was owed × {rate}% a year ÷ 365, until paid.', { rate: Number(report.data.costOfCapitalPct) })}
            {report.data.uncostedLines > 0 && ` ${t('{n} line(s) were on trips not costed yet — they show no trip costs.', { n: report.data.uncostedLines })}`}
          </p>
          {report.data.uncostedLines > 0 && canManage && (
            <button type="button" className="button" disabled={backfill.isPending} onClick={() => backfill.mutate(undefined)}>
              {t('Work out costs for trips closed earlier')}
            </button>
          )}
        </>
      )}
      {settings.data && (
        <div className="contribution-setting">
          <span>
            {t('Running costs (fuel, tolls, vehicle, crew) are shared {pct}% by KG and {rest}% by verified service time; loading costs and write-offs by KG.', {
              pct: Number(settings.data.kgSharePct),
              rest: 100 - Number(settings.data.kgSharePct),
            })}
          </span>
          {canManage && (
            <button type="button" className="button button-ghost button-small" onClick={() => setEditing(true)}>
              {t('Change')}
            </button>
          )}
        </div>
      )}
      {editing && settings.data && <ShareDialog current={settings.data.kgSharePct} onClose={() => setEditing(false)} />}
    </section>
  );
}

function ShareDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const t = useT();
  const [pct, setPct] = useState(String(Number(current)));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: { kgSharePct: number }) => apiSend('PUT', 'costing/settings', body), [['costing']], onClose);
  return (
    <FormDialog
      title={t('How trip costs are shared')}
      description={<p>{t('Trips that close from now on use it; trips already closed keep the split they were costed with.')}</p>}
      submitLabel={t('Save')}
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const value = Number(pct);
        if (!(value >= 0 && value <= 100)) return setProblem(t('Enter a percentage from 0 to 100.'));
        setProblem(null);
        save.mutate({ kgSharePct: Math.round(value * 100) / 100 });
      }}
    >
      <Field label="Share by KG (%)" hint="The rest by verified service time — a customer without 30 days of it stays on KG">
        {(p) => <input {...p} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
