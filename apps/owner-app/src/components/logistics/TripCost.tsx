'use client';

import { useQuery } from '@tanstack/react-query';
import type { CostComponent, TripCostRecord } from '@morbeez/shared-types';
import { apiGet } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/use-lookups';
import { formatQuantity, formatRate } from '@/lib/format';
import { KeyValues } from '@/components/ui/DetailPanel';
import { SkeletonLines } from '@/components/ui/Panel';
import { useT } from '@/lib/i18n';

const LABEL: Record<CostComponent, string> = {
  fuel: 'Fuel',
  tolls: 'Tolls & parking',
  repairs: 'Road repairs',
  driverIncentives: "Driver's incentives",
  otherExpenses: 'Other expenses',
  vehicle: 'Vehicle (by km)',
  labour: 'Loading labour',
  helperIncentives: "Helpers' incentives",
  writtenOff: 'Stock written off',
};
const RUNNING: CostComponent[] = ['fuel', 'tolls', 'repairs', 'driverIncentives', 'otherExpenses', 'vehicle'];
const LOAD: CostComponent[] = ['labour', 'helperIncentives', 'writtenOff'];

/**
 * A closed trip's cost (Master Spec v3 P5): what it cost, how it was shared
 * out to what it delivered and picked up, and its delivery cost per KG
 * against the standard — the rolling 30 days before it.
 */
export function TripCost({ tripId }: { tripId: string }) {
  const t = useT();
  const currency = useCurrency();
  const cost = useQuery({
    queryKey: ['costing', 'trip', tripId],
    queryFn: () => apiGet<TripCostRecord>(`costing/trips/${tripId}`),
    retry: false,
  });
  if (cost.isPending) return <SkeletonLines lines={3} />;
  if (cost.error || !cost.data) return <p className="muted">{t('This trip closed before trip costs were worked out.')}</p>;
  const c = cost.data;
  const money = (v: string) => formatRate(v, currency);
  const variance = c.variancePerKg === null ? null : Number(c.variancePerKg);
  const lines = (keys: CostComponent[]) =>
    keys.filter((k) => Number(c.components[k]) > 0).map((k) => [LABEL[k], money(c.components[k])] as [string, string]);

  return (
    <section className="trip-cost" aria-label={t('Cost of this trip')}>
      <h3 className="detail-subhead">{t('Cost of this trip')}</h3>
      <KeyValues
        items={[
          ['Total', money(c.total)],
          ...lines(RUNNING),
          ...lines(LOAD),
          ...(c.tripKm && c.vehicleRatePerKm
            ? ([['Vehicle rate', `${formatQuantity(c.tripKm, 'km')} × ${money(c.vehicleRatePerKm)}/km`]] as [string, string][])
            : []),
          [
            'Shared out',
            `${t('{n} order line(s)', { n: c.orderLines })} · ${money(c.deliveryCost)}${c.lots > 0 ? ` · ${t('{n} lot(s) picked up', { n: c.lots })} · ${money(c.inboundCost)}` : ''}`,
          ],
          ...(Number(c.unallocated) > 0 ? ([['Not shared out', `${money(c.unallocated)} — ${c.unallocatedReason ?? ''}`]] as [string, string][]) : []),
          ['Delivery cost per KG', c.actualPerKg === null ? '—' : `${money(c.actualPerKg)} · ${formatQuantity(c.deliveredKg, 'kg')}`],
          [
            'Standard per KG',
            c.standardPerKg === null
              ? t('Not yet — 3 closed trips in 30 days set it')
              : `${money(c.standardPerKg)} · ${c.standardBasis === 'route' ? t('this route, {n} trips', { n: c.standardTrips }) : t('the business, {n} trips', { n: c.standardTrips })}`,
          ],
          [
            'Variance',
            variance === null ? (
              '—'
            ) : variance === 0 ? (
              t('On the standard')
            ) : (
              <span className="trip-cost-variance" data-tone={variance > 0 ? 'bad' : 'good'}>
                {`${variance > 0 ? '+' : '−'}${money(String(Math.abs(variance)))}/kg ${variance > 0 ? t('over the standard') : t('under the standard')}`}
              </span>
            ),
          ],
        ]}
      />
      <p className="muted footnote">
        {t('Running costs are shared {pct}% by KG and the rest by verified service time; loading costs and write-offs by KG delivered. Driver base pay is never shared out.', {
          pct: Number(c.kgSharePct),
        })}
        {c.unweightedLines > 0 ? ` ${t('{n} line(s) had no weight — set the product’s weight per unit.', { n: c.unweightedLines })}` : ''}
      </p>
    </section>
  );
}
