'use client';

import { useMemo, useState } from 'react';
import type { LotRecord, ProductStockRow } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, PageHeader, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel } from '@/components/ui/DetailPanel';
import { Field, FormDialog } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useLocations, useProductLots, useStockOverview } from '@/lib/hooks/use-modules';
import { useCurrency, useFarmerName, useProductName, useProductUom, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { daysSince, formatCount, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';
import { optionalText, parseQuantity } from '@/lib/parse';

// Same window as the dashboard's aging_stock alert
// (ALERT_THRESHOLDS.agingStockAfterDays in the backend) — produce, not
// durable goods.
const AGING_AFTER_DAYS = 3;

// Stock changes move the stock value on the dashboard too.
const STOCK_EFFECTS = [KEYS.inventory, KEYS.dashboard];

type LotAction = 'shrinkage' | 'reject' | 'transfer';

const ACTION_COPY: Record<LotAction, { title: string; submit: string; description: string }> = {
  shrinkage: {
    title: 'Record shrinkage',
    submit: 'Record shrinkage',
    description: "Weight or count lost in storage — drying, trimming, spoilage. It comes off this lot's quantity on hand.",
  },
  reject: {
    title: 'Reject from stock',
    submit: 'Reject',
    description: "A quality problem found after grading. The rejected quantity comes off this lot and can't be sold.",
  },
  transfer: {
    title: 'Move lot',
    submit: 'Move',
    description: 'Moves the whole lot to another warehouse or vehicle.',
  },
};

function LotActionDialog({ lot, action, onClose }: { lot: LotRecord; action: LotAction; onClose: () => void }) {
  const productUom = useProductUom();
  const uom = productUom(lot.productId);
  const locations = useLocations(action === 'transfer');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const run = useAction(
    (body: Record<string, unknown>) => apiSend<LotRecord>('POST', `inventory/lots/${lot.id}/${action}`, body),
    STOCK_EFFECTS,
    onClose,
  );
  const copy = ACTION_COPY[action];
  const destinations = (locations.data?.items ?? []).filter(
    (l) => l.status === 'active' && l.id !== lot.currentLocationId,
  );

  const submit = () => {
    if (action === 'transfer') {
      if (!toLocationId) return setProblem('Choose where the lot is going.');
      setProblem(null);
      return run.mutate({ version: lot.version, toLocationId });
    }
    const parsed = parseQuantity(quantity, 'the quantity');
    if (!parsed.ok) return setProblem(parsed.error);
    if (Math.round(parsed.value * 1000) > Math.round(Number(lot.currentQuantity ?? 0) * 1000)) {
      return setProblem(`That's more than the ${formatQuantity(lot.currentQuantity, uom)} on hand.`);
    }
    setProblem(null);
    run.mutate({ version: lot.version, quantity: parsed.value, reason: optionalText(reason) });
  };

  return (
    <FormDialog
      title={copy.title}
      description={
        <p>
          {copy.description} On hand now: {formatQuantity(lot.currentQuantity, uom)}.
        </p>
      }
      submitLabel={copy.submit}
      tone={action === 'reject' ? 'danger' : undefined}
      pending={run.isPending}
      error={problem ?? run.error}
      onClose={onClose}
      onSubmit={submit}
    >
      {action === 'transfer' ? (
        <Field label="Move to" wide>
          {(props) => (
            <select {...props} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">
                {locations.isPending ? 'Loading…' : destinations.length === 0 ? 'No other locations set up' : 'Choose a location…'}
              </option>
              {destinations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <>
          <Field label={`Quantity (${uom})`}>
            {(props) => <input {...props} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
          </Field>
          <Field label="Reason (optional)">
            {(props) => <input {...props} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function ProductLots({ row, onClose }: { row: ProductStockRow; onClose: () => void }) {
  const { productId } = row;
  const { data, error, isPending, refetch } = useProductLots(productId);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const productName = useProductName();
  const productUom = useProductUom();
  const farmerName = useFarmerName();
  const uom = productUom(productId);
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'inventory:write');
  const locations = useLocations(true);
  const locationName = (id: string | null) => (id ? (locations.data?.items.find((l) => l.id === id)?.name ?? '—') : '—');
  const [acting, setActing] = useState<{ lot: LotRecord; action: LotAction } | null>(null);

  // The endpoint returns graded lots only; delivered and rejected ones are
  // history, not stock. Ungraded arrivals are summarised from the overview row.
  const inStock = (data ?? []).filter((lot) => lot.status === 'available' || lot.status === 'reserved');
  const columns = canWrite ? 8 : 7;

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
                <th>Where</th>
                <th className="align-right">On hand</th>
                <th className="align-right">Unit cost</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {inStock.length === 0 && <EmptyRow colSpan={columns}>No graded lots in stock.</EmptyRow>}
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
                    <td>{locationName(lot.currentLocationId)}</td>
                    <td className="align-right">{formatQuantity(lot.currentQuantity ?? lot.receivedQuantity, uom)}</td>
                    <td className="align-right">{lot.unitCost ? formatMoney(lot.unitCost, currency) : '—'}</td>
                    {canWrite && (
                      <td>
                        {/* A reserved lot is promised to an order; only available stock can change. */}
                        {lot.status === 'available' && (
                          <span className="row-actions">
                            <button
                              type="button"
                              className="button button-small"
                              onClick={() => setActing({ lot, action: 'shrinkage' })}
                            >
                              Shrinkage
                            </button>
                            <button
                              type="button"
                              className="button button-small"
                              onClick={() => setActing({ lot, action: 'reject' })}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="button button-small"
                              onClick={() => setActing({ lot, action: 'transfer' })}
                            >
                              Move
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {row.ungradedLots > 0 && (
            <p className="footnote">
              Plus {row.ungradedLots} lot{row.ungradedLots === 1 ? '' : 's'} ({formatQuantity(row.ungradedQuantity, uom)})
              waiting for grading — grade them from the purchase order in Procurement.
            </p>
          )}
        </div>
      )}
      {acting && <LotActionDialog lot={acting.lot} action={acting.action} onClose={() => setActing(null)} />}
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
