'use client';

import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { useTripQuantities } from '@/lib/hooks/use-trips';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';

const q = (value: string | null, uom: string) => (value === null ? '—' : formatQuantity(String(Number(value)), uom));
// In the table, kilos go without the unit (the heading says kg); other units keep theirs.
const cell = (value: string | null, uom: string) => (value === null ? '—' : uom === 'kg' ? formatQuantity(String(Number(value))) : q(value, uom));

/**
 * Quantity reconciliation (client design, Trip Details → Quantities):
 * product by product, what went onto the vehicle from the store, what was
 * picked up at farms, what was delivered (and sold on the spot), and the
 * balance — what should be on the vehicle. Closed with a count, the count,
 * what came back to the store and what was written off.
 */
export function TripQuantitiesView({ tripId }: { tripId: string }) {
  const t = useT();
  const { data, error, isPending, refetch } = useTripQuantities(tripId);
  if (isPending) return <SkeletonLines lines={4} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (data.rows.length === 0) return <p className="muted">{t('Nothing on this trip yet.')}</p>;
  const counted = data.balanced !== null;
  const closing = data.rows.filter((r) => Number(r.counted ?? 0) > 0);
  const spot = Number(data.totalsKg.spotSold) > 0;
  // Sold on the spot, back in the store, written off — under the table, so its columns stay narrow.
  const notes = data.rows
    .map((r) => ({
      productId: r.productId,
      product: r.product,
      parts: [
        Number(r.spotSold) > 0 && t('{q} sold on the spot', { q: q(r.spotSold, r.uom) }),
        Number(r.returned) > 0 && t('{q} came back', { q: q(r.returned, r.uom) }),
        Number(r.writtenOff) > 0 && t('{q} written off', { q: q(r.writtenOff, r.uom) }),
      ].filter((p): p is string => typeof p === 'string'),
    }))
    .filter((n) => n.parts.length > 0);
  return (
    <>
      <h3 className="detail-subhead">{t('Quantity Reconciliation')} (kg)</h3>
      <div className="table-wrap">
        <table className="table qty-table">
          <thead>
            <tr>
              <th>{t('Product')}</th>
              <th className="align-right">{t('Loaded')}</th>
              <th className="align-right">{t('Procured')}</th>
              <th className="align-right">{t('Delivered')}</th>
              <th className="align-right">{t('Balance')}</th>
              {counted && <th className="align-right">{t('Counted')}</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.productId}>
                <td>{r.product}</td>
                <td className="num">{cell(r.loaded, r.uom)}</td>
                <td className="num">{cell(r.procured, r.uom)}</td>
                <td className="num">{cell(r.delivered, r.uom)}</td>
                <td className="num" data-tone={Number(r.expected) !== 0 ? 'attention' : undefined}>
                  {cell(r.expected, r.uom)}
                </td>
                {counted && (
                  <td className="num" data-tone={Math.abs(Number(r.difference)) >= 0.0005 ? 'bad' : undefined}>
                    {cell(r.counted, r.uom)}
                  </td>
                )}
              </tr>
            ))}
            <tr className="total-row">
              <td>{t('Total (kg)')}</td>
              <td className="num">{cell(data.totalsKg.loaded, 'kg')}</td>
              <td className="num">{cell(data.totalsKg.procured, 'kg')}</td>
              <td className="num">{cell(data.totalsKg.delivered, 'kg')}</td>
              <td className="num">{cell(data.totalsKg.expected, 'kg')}</td>
              {counted && <td className="num">{cell(data.totalsKg.counted, 'kg')}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      {notes.length > 0 && (
        <ul className="plain-list muted">
          {notes.map((n) => (
            <li key={n.productId}>
              {n.product}: {n.parts.join(' · ')}
            </li>
          ))}
        </ul>
      )}
      <div className="qty-balance" data-tone={data.balanced === false ? 'bad' : data.balanced ? 'ok' : 'info'}>
        {data.balanced === true ? (
          <>
            <strong>{t('Quantities are in balance')}</strong>
            <span>{spot ? t('Loaded + Procured = Delivered + Spot sales + Vehicle stock') : t('Loaded + Procured = Delivered + Vehicle stock')}</span>
            <span>
              {q(data.totalsKg.loaded, 'kg')} + {q(data.totalsKg.procured, 'kg')} = {q(data.totalsKg.delivered, 'kg')}
              {spot && <> + {q(data.totalsKg.spotSold, 'kg')}</>} + {q(data.totalsKg.counted, 'kg')}
            </span>
          </>
        ) : data.balanced === false ? (
          <>
            <strong>{t('Quantities are not in balance')}</strong>
            <span>{t('What was counted on the vehicle at closing differs from the balance — see the closure checks.')}</span>
          </>
        ) : (
          <>
            <strong>{spot ? t('Balance = Loaded + Procured − Delivered − Spot sales') : t('Balance = Loaded + Procured − Delivered')}</strong>
            <span>{t('What should be on the vehicle. It is counted when the trip is closed.')}</span>
          </>
        )}
      </div>
      {counted && (
        <>
          <h3 className="detail-subhead">{t('Vehicle Closing Stock')}</h3>
          {closing.length === 0 ? (
            <p className="muted">{t('Nothing left on the vehicle.')}</p>
          ) : (
            <ul className="plain-list">
              {closing.map((r) => (
                <li key={r.productId}>
                  {r.product} <strong>{q(r.counted, r.uom)}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
