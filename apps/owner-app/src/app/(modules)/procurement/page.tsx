'use client';

import { useState } from 'react';
import type { PurchaseOrderStatus } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, FilterTabs, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { usePurchaseOrder, usePurchaseOrders } from '@/lib/hooks/use-modules';
import { useCurrency, useFarmerName, useProductName, useProductUom, useTenantProfile } from '@/lib/hooks/use-lookups';
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'placed' as const, label: 'To confirm' },
  { value: 'confirmed' as const, label: 'Awaiting produce' },
  { value: 'received' as const, label: 'To grade' },
  { value: 'graded' as const, label: 'Graded' },
  { value: 'closed' as const, label: 'Closed' },
  { value: 'cancelled' as const, label: 'Cancelled' },
];

// Purchase-order statuses read differently from order statuses — 'placed'
// here is waiting on the farmer's confirmation, 'confirmed' is waiting on
// produce, 'received' is waiting on grading.
const PO_LABEL: Partial<Record<PurchaseOrderStatus, string>> = {
  placed: 'To confirm',
  confirmed: 'Awaiting produce',
  received: 'To grade',
};

function PurchaseOrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, isPending, refetch } = usePurchaseOrder(id);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const farmerName = useFarmerName();
  const productName = useProductName();
  const productUom = useProductUom();

  return (
    <DetailPanel title="Purchase order" onClose={onClose}>
      {isPending ? (
        <SkeletonLines lines={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <KeyValues
            items={[
              ['Farmer', farmerName(data.order.farmerId)],
              ['Status', <StatusBadge key="s" status={data.order.status} label={PO_LABEL[data.order.status]} />],
              ['Raised', formatDateTime(data.order.createdAt, timeZone)],
              [
                'Expected',
                data.order.expectedDeliveryDate ? formatDate(data.order.expectedDeliveryDate.slice(0, 10)) : '—',
              ],
            ]}
          />

          <h3 className="detail-subhead">Ordered</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="align-right">Expected</th>
                  <th className="align-right">Indicative rate</th>
                </tr>
              </thead>
              <tbody>
                {(data.order.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td>{productName(line.productId)}</td>
                    <td className="align-right">
                      {formatQuantity(line.expectedQuantity, productUom(line.productId))}
                    </td>
                    <td className="align-right">{formatMoney(line.indicativePrice, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="detail-subhead">Lots received</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th className="align-right">Received</th>
                  <th className="align-right">Accepted</th>
                  <th>Grade</th>
                  <th className="align-right">Unit cost</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.lots.length === 0 && <EmptyRow colSpan={7}>Nothing received yet.</EmptyRow>}
                {data.lots.map((lot) => {
                  const settlement = data.settlements.find((s) => s.lotId === lot.id);
                  const uom = productUom(lot.productId);
                  return (
                    <tr key={lot.id}>
                      <td>{productName(lot.productId)}</td>
                      <td>
                        <StatusBadge status={lot.status} />
                      </td>
                      <td className="align-right">{formatQuantity(lot.receivedQuantity, uom)}</td>
                      <td className="align-right">{formatQuantity(lot.acceptedQuantity, uom)}</td>
                      <td>{lot.grade ?? '—'}</td>
                      <td className="align-right">{lot.unitCost ? formatMoney(lot.unitCost, currency) : '—'}</td>
                      <td>
                        {settlement ? (
                          <StatusBadge status="paid" tone="done" label={formatMoney(settlement.amount, currency)} />
                        ) : lot.unitCost && lot.acceptedQuantity && Number(lot.acceptedQuantity) > 0 ? (
                          <StatusBadge status="unpaid" tone="attention" label="Unpaid" />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.pickups.length > 0 && (
            <>
              <h3 className="detail-subhead">Pickups</h3>
              <ul className="plain-list">
                {data.pickups.map((pickup) => (
                  <li key={pickup.id}>
                    <StatusBadge status={pickup.status} />{' '}
                    {pickup.status === 'completed'
                      ? `Picked up ${formatDateTime(pickup.pickedUpAt, timeZone)}`
                      : `Scheduled ${formatDateTime(pickup.scheduledAt, timeZone)}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </DetailPanel>
  );
}

export default function ProcurementPage() {
  const [status, setStatus] = useState<PurchaseOrderStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, isPending, isPlaceholderData, refetch } = usePurchaseOrders(
    status === 'all' ? undefined : status,
    page,
  );
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const farmerName = useFarmerName();

  return (
    <div className="stack">
      <PageHeader
        title="Procurement"
        subtitle="Purchase orders to farmers — from order, through pickup and grading, to payment."
      />
      <div className="split" data-detail={selected ? 'open' : undefined}>
        <Panel
          title="Purchase orders"
          meta={
            <FilterTabs
              label="Filter by status"
              options={FILTERS}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
                setSelected(null);
              }}
            />
          }
        >
          {isPending ? (
            <SkeletonLines lines={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <div data-updating={isPlaceholderData || undefined} className="updating">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Raised</th>
                      <th>Farmer</th>
                      <th>Status</th>
                      <th className="align-right">Expected value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <EmptyRow colSpan={4}>No purchase orders here.</EmptyRow>}
                    {data.items.map((po) => (
                      <SelectableRow
                        key={po.id}
                        selected={selected === po.id}
                        onSelect={() => setSelected(po.id)}
                        label={`Purchase order from ${farmerName(po.farmerId)}`}
                      >
                        <td>{formatDateTime(po.createdAt, timeZone)}</td>
                        <td>{farmerName(po.farmerId)}</td>
                        <td>
                          <StatusBadge status={po.status} label={PO_LABEL[po.status]} />
                        </td>
                        <td className="align-right">
                          {po.expectedValue ? formatMoney(po.expectedValue, currency) : '—'}
                        </td>
                      </SelectableRow>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </div>
          )}
        </Panel>
        {selected && <PurchaseOrderDetail key={selected} id={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
