'use client';

import { useMemo, useState } from 'react';
import type { LotRecord, ProductStockRow } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, SelectableRow } from '@/components/ui/ListControls';
import { DayTabs } from '@/components/redesign/ListCards';
import { Icon } from '@/components/ui/Icon';
import { useVehicleBoard } from '@/lib/hooks/use-money-stock';
import { useT } from '@/lib/i18n';
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
  const inStock = (data ?? []).filter((lot) => lot.status === 'available' && Number(lot.currentQuantity ?? 0) > 0);
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
                    <td className="align-right">
                      {formatQuantity(lot.currentQuantity ?? lot.receivedQuantity, uom)}
                      {Number(lot.reservedQuantity) > 0 && <div className="muted">{formatQuantity(lot.reservedQuantity, uom)} held for orders</div>}
                    </td>
                    <td className="align-right">{lot.unitCost ? formatMoney(lot.unitCost, currency) : '—'}</td>
                    {canWrite && (
                      <td>
                        {/* Only the kilos not held for orders, in the store, can be written off or moved. */}
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

/** Vehicle Stock (client design V1.1, screen 13): what's on each vehicle now — committed to its deliveries, and free. */
function VehicleStock() {
  const t = useT();
  const { data, error, isPending, refetch } = useVehicleBoard();
  const [vehicleId, setVehicleId] = useState('');
  if (isPending) return <SkeletonLines lines={5} height={64} />;
  if (error) {
    return (
      <div className="panel">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  const cards = vehicleId ? data.vehicles.filter((v) => v.vehicleId === vehicleId) : data.vehicles;
  const totals = vehicleId
    ? cards.reduce(
        (sum, v) => {
          for (const p of v.products.filter((x) => x.uom === 'kg')) {
            sum.onVehicles += Number(p.onVehicle);
            sum.committed += Number(p.committed);
            sum.free += Number(p.free);
          }
          return sum;
        },
        { onVehicles: 0, committed: 0, free: 0 },
      )
    : { onVehicles: Number(data.totalsKg.onVehicles), committed: Number(data.totalsKg.committed), free: Number(data.totalsKg.free) };
  const kg = (value: number | string) => formatQuantity(String(Number(value)), 'kg');
  return (
    <>
      <label className="vehicle-filter">
        <span className="visually-hidden">{t('Which vehicles')}</span>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">{t('All Vehicles')}</option>
          {data.vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {v.registrationNumber}
            </option>
          ))}
        </select>
      </label>
      <div className="card-list">
        {cards.length === 0 && <div className="list-empty">{t('Nothing is on a vehicle right now.')}</div>}
        {cards.map((v) => (
          <section key={v.vehicleId} className="vehicle-stock-card" aria-label={v.registrationNumber}>
            <div className="vehicle-stock-head">
              <span className="list-card-badge" aria-hidden="true">
                <Icon name="truck" size={20} />
              </span>
              <span className="vehicle-stock-name">
                <strong>{v.registrationNumber}</strong>
                <span className="muted">
                  {[v.driverName, v.status === 'in_transit' ? t('In Transit') : t('Available')].filter(Boolean).join(' · ')}
                  {v.tripNumber && (
                    <>
                      {' · '}
                      <span className="nowrap">{v.tripNumber}</span>
                    </>
                  )}
                </span>
              </span>
              <span className="vehicle-stock-total">
                <span className="muted">{t('Total')}</span> <strong>{kg(v.totalKg)}</strong>
              </span>
            </div>
            <ul className="vehicle-stock-lines">
              {v.products.length === 0 && <li className="muted">{t('Nothing aboard')}</li>}
              {v.products.map((p) => (
                <li key={p.productId}>
                  <span>{p.product}</span>
                  <span className="num">
                    {formatQuantity(String(Number(p.onVehicle)), p.uom)}
                    {Number(p.committed) > 0 && <span className="muted"> · {t('{q} committed', { q: formatQuantity(String(Number(p.committed)), p.uom) })}</span>}
                    {Number(p.toDeliver) > Number(p.onVehicle) && (
                      <span className="vehicle-stock-short"> · {t('{q} short', { q: formatQuantity(String(Number(p.toDeliver) - Number(p.onVehicle)), p.uom) })}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="stock-totals">
        <div>
          <span>{t('Total on Vehicles')}</span>
          <strong>{kg(totals.onVehicles)}</strong>
        </div>
        <div>
          <span>{t('Committed')}</span>
          <strong>{kg(totals.committed)}</strong>
        </div>
        <div data-tone="good">
          <span>{t('Free Stock')}</span>
          <strong>{kg(totals.free)}</strong>
        </div>
      </div>
    </>
  );
}

/** Total Stock: every product, in the store and out on vehicles; a product opens its lots. */
function TotalStock() {
  const t = useT();
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
    <>
      {data && (
        <Figures
          items={[
            { label: t('Stock value at cost'), value: formatMoney(sumMoney(rows.map((r) => r.valueAtCost)), currency) },
            { label: t('Products in stock'), value: formatCount(rows.filter((r) => Number(r.physical) > 0).length) },
            {
              label: t('Lots waiting for grading'),
              value: formatCount(rows.reduce((n, r) => n + r.ungradedLots, 0)),
              tone: rows.some((r) => r.ungradedLots > 0) ? 'attention' : undefined,
            },
            {
              label: t('Products with stock {n}+ days old', { n: AGING_AFTER_DAYS }),
              value: formatCount(aging),
              tone: aging > 0 ? 'attention' : undefined,
            },
          ]}
        />
      )}
      <div className="split" data-detail={selectedRow ? 'open' : undefined}>
        <Panel title={t('Stock by product')} meta={t('free = on hand − held for orders')}>
          {isPending ? (
            <SkeletonLines lines={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Product')}</th>
                    <th className="align-right">{t('On hand')}</th>
                    <th className="align-right">{t('In store')}</th>
                    <th className="align-right">{t('On vehicles')}</th>
                    <th className="align-right">{t('Held for orders')}</th>
                    <th className="align-right">{t('Free')}</th>
                    <th className="align-right">{t('Value at cost')}</th>
                    <th className="align-right">{t('Oldest')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <EmptyRow colSpan={8}>{t('No stock recorded yet.')}</EmptyRow>}
                  {rows.map((row) => {
                    const uom = productUom(row.productId);
                    const age = daysSince(row.oldestAvailableReceivedAt);
                    const inStore = (Number(row.physical) - Number(row.onVehicles)).toFixed(3);
                    return (
                      <SelectableRow
                        key={row.productId}
                        selected={selected === row.productId}
                        onSelect={() => setSelected(row.productId)}
                        label={`Lots of ${productName(row.productId)}`}
                      >
                        <td>
                          {productName(row.productId)}
                          {row.ungradedLots > 0 && <div className="muted">{t('{q} to grade', { q: formatQuantity(row.ungradedQuantity, uom) })}</div>}
                        </td>
                        <td className="align-right strong">{formatQuantity(row.physical, uom)}</td>
                        <td className="align-right">{formatQuantity(inStore, uom)}</td>
                        <td className="align-right">{formatQuantity(row.onVehicles, uom)}</td>
                        <td className="align-right">{formatQuantity(row.reserved, uom)}</td>
                        <td className="align-right">{formatQuantity(row.available, uom)}</td>
                        <td className="align-right">{formatMoney(row.valueAtCost, currency)}</td>
                        <td className="align-right">
                          {age === null ? (
                            '—'
                          ) : age >= AGING_AFTER_DAYS ? (
                            <StatusBadge status="aging" tone="attention" label={t('{n} days', { n: age })} />
                          ) : age === 0 ? (
                            t('Today')
                          ) : (
                            t(age === 1 ? '{n} day' : '{n} days', { n: age })
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
    </>
  );
}

type StockTab = 'vehicles' | 'total';

/** Inventory (client design V1.1, screen 13): Vehicle Stock and Total Stock. */
export default function InventoryPage() {
  const t = useT();
  const [tab, setTab] = useState<StockTab>('vehicles');
  return (
    <div className="stack" style={{ maxWidth: tab === 'vehicles' ? 760 : undefined }}>
      <h1 className="page-title visually-hidden">{t('Inventory')}</h1>
      <DayTabs
        label="Stock view"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'vehicles', label: 'Vehicle Stock' },
          { value: 'total', label: 'Total Stock' },
        ]}
      />
      {tab === 'vehicles' ? <VehicleStock /> : <TotalStock />}
    </div>
  );
}
