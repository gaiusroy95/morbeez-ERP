'use client';

import { useMemo, useState } from 'react';
import type { ProductStockRow } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, PageHeader, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel } from '@/components/ui/DetailPanel';
import { useProductLots, useStockOverview } from '@/lib/hooks/use-modules';
import { useCurrency, useFarmerName, useProductName, useProductUom, useTenantProfile } from '@/lib/hooks/use-lookups';
import { daysSince, formatCount, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';

// Same window as the dashboard's aging_stock alert
// (ALERT_THRESHOLDS.agingStockAfterDays in the backend) — produce, not
// durable goods.
const AGING_AFTER_DAYS = 3;

function ProductLots({ row, onClose }: { row: ProductStockRow; onClose: () => void }) {
  const { productId } = row;
  const { data, error, isPending, refetch } = useProductLots(productId);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const productName = useProductName();
  const productUom = useProductUom();
  const farmerName = useFarmerName();
  const uom = productUom(productId);

  // The endpoint returns graded lots only; delivered and rejected ones are
  // history, not stock. Ungraded arrivals are summarised from the overview row.
  const inStock = (data ?? []).filter((lot) => lot.status === 'available' || lot.status === 'reserved');

  return (
    <DetailPanel title={`${productName(productId)} — lots in stock`} onClose={onClose}>
      {isPending ? (
        <SkeletonLines lines={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Farmer</th>
                <th>Status</th>
                <th>Grade</th>
                <th className="align-right">On hand</th>
                <th className="align-right">Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {inStock.length === 0 && <EmptyRow colSpan={6}>No graded lots in stock.</EmptyRow>}
              {inStock.map((lot) => {
                const age = daysSince(lot.receivedAt);
                return (
                  <tr key={lot.id}>
                    <td>
                      {formatDateTime(lot.receivedAt, timeZone)}
                      {lot.status === 'available' && age !== null && age >= AGING_AFTER_DAYS && (
                        <>
                          {' '}
                          <StatusBadge status="aging" tone="attention" label={`${age} days`} />
                        </>
                      )}
                    </td>
                    <td>{farmerName(lot.farmerId)}</td>
                    <td>
                      <StatusBadge status={lot.status} />
                    </td>
                    <td>{lot.grade ?? '—'}</td>
                    <td className="align-right">
                      {formatQuantity(lot.currentQuantity ?? lot.receivedQuantity, uom)}
                    </td>
                    <td className="align-right">{lot.unitCost ? formatMoney(lot.unitCost, currency) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {row.ungradedLots > 0 && (
            <p className="footnote">
              Plus {row.ungradedLots} lot{row.ungradedLots === 1 ? '' : 's'} ({formatQuantity(row.ungradedQuantity, uom)})
              waiting for grading — they become stock once graded.
            </p>
          )}
        </div>
      )}
    </DetailPanel>
  );
}

export default function InventoryPage() {
  const { data, error, isPending, refetch } = useStockOverview();
  const [selected, setSelected] = useState<string | null>(null);
  const currency = useCurrency();
  const productName = useProductName();
  const productUom = useProductUom();

  const rows = useMemo(
    () =>
      (data ?? [])
        // A product whose lots were all delivered or rejected has nothing on the floor.
        .filter((row) => Number(row.physical) > 0 || row.ungradedLots > 0)
        .sort((a, b) => productName(a.productId).localeCompare(productName(b.productId))),
    [data, productName],
  );
  const selectedRow = rows.find((row) => row.productId === selected) ?? null;
  const aging = rows.filter((row) => {
    const age = daysSince(row.oldestAvailableReceivedAt);
    return age !== null && age >= AGING_AFTER_DAYS;
  }).length;

  return (
    <div className="stack">
      <PageHeader
        title="Inventory"
        subtitle="What's in the warehouse right now — sellable, promised to orders, and still to be graded."
      />
      {data && (
        <Figures
          items={[
            { label: 'Stock value at cost', value: formatMoney(sumMoney(rows.map((r) => r.valueAtCost)), currency) },
            { label: 'Products in stock', value: formatCount(rows.filter((r) => Number(r.physical) > 0).length) },
            {
              label: 'Lots waiting for grading',
              value: formatCount(rows.reduce((n, r) => n + r.ungradedLots, 0)),
              tone: rows.some((r) => r.ungradedLots > 0) ? 'attention' : undefined,
            },
            {
              label: `Products with stock ${AGING_AFTER_DAYS}+ days old`,
              value: formatCount(aging),
              tone: aging > 0 ? 'attention' : undefined,
            },
          ]}
        />
      )}
      <div className="split" data-detail={selectedRow ? 'open' : undefined}>
        <Panel title="Stock by product" meta="available = on hand − reserved">
          {isPending ? (
            <SkeletonLines lines={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="align-right">Available</th>
                    <th className="align-right">Reserved</th>
                    <th className="align-right">On hand</th>
                    <th className="align-right">Ungraded</th>
                    <th className="align-right">Value at cost</th>
                    <th className="align-right">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <EmptyRow colSpan={7}>No stock recorded yet.</EmptyRow>}
                  {rows.map((row) => {
                    const uom = productUom(row.productId);
                    const age = daysSince(row.oldestAvailableReceivedAt);
                    return (
                      <SelectableRow
                        key={row.productId}
                        selected={selected === row.productId}
                        onSelect={() => setSelected(row.productId)}
                        label={`Lots of ${productName(row.productId)}`}
                      >
                        <td>{productName(row.productId)}</td>
                        <td className="align-right strong">{formatQuantity(row.available, uom)}</td>
                        <td className="align-right">{formatQuantity(row.reserved, uom)}</td>
                        <td className="align-right">{formatQuantity(row.physical, uom)}</td>
                        <td className="align-right">
                          {row.ungradedLots > 0 ? formatQuantity(row.ungradedQuantity, uom) : '—'}
                        </td>
                        <td className="align-right">{formatMoney(row.valueAtCost, currency)}</td>
                        <td className="align-right">
                          {age === null ? (
                            '—'
                          ) : age >= AGING_AFTER_DAYS ? (
                            <StatusBadge status="aging" tone="attention" label={`${age} days`} />
                          ) : age === 0 ? (
                            'Today'
                          ) : (
                            `${age} day${age === 1 ? '' : 's'}`
                          )}
                        </td>
                      </SelectableRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        {selectedRow && <ProductLots key={selectedRow.productId} row={selectedRow} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
