'use client';

import { useState } from 'react';
import type { OrderRecord, OrderStatus } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, FilterTabs, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { useOrder, useOrders } from '@/lib/hooks/use-modules';
import { useCurrency, useCustomerName, useProductName, useProductUom, useTenantProfile } from '@/lib/hooks/use-lookups';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'placed' as const, label: 'To confirm' },
  { value: 'confirmed' as const, label: 'Confirmed' },
  { value: 'delivered' as const, label: 'Delivered' },
  { value: 'cancelled' as const, label: 'Cancelled' },
];

// A placed order carrying an approval request is waiting on a decision,
// not on the person who took it — show that difference.
function orderBadge(order: OrderRecord) {
  if (order.status === 'placed' && order.approvalRequestId) return <StatusBadge status="awaiting_approval" />;
  return <StatusBadge status={order.status} />;
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, isPending, refetch } = useOrder(id);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const customerName = useCustomerName();
  const productName = useProductName();
  const productUom = useProductUom();

  return (
    <DetailPanel title="Order" onClose={onClose}>
      {isPending ? (
        <SkeletonLines lines={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <KeyValues
            items={[
              ['Customer', customerName(data.customerId)],
              ['Status', orderBadge(data)],
              ['Placed', formatDateTime(data.createdAt, timeZone)],
              ['Last change', formatDateTime(data.updatedAt, timeZone)],
            ]}
          />
          <h3 className="detail-subhead">Lines</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="align-right">Quantity</th>
                  <th className="align-right">Price</th>
                  <th className="align-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {(data.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td>{productName(line.productId)}</td>
                    <td className="align-right">{formatQuantity(line.quantity, productUom(line.productId))}</td>
                    <td className="align-right">{formatMoney(line.unitPrice, currency)}</td>
                    <td className="align-right">
                      {/* Display only — the order total below comes from the server. */}
                      {formatMoney(String(Number(line.quantity) * Number(line.unitPrice)), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            Delivered orders consume the stock lots reserved for them; payment against the order shows under Finance →
            Receivables.
          </p>
        </>
      )}
    </DetailPanel>
  );
}

export default function OrdersPage() {
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, isPending, isPlaceholderData, refetch } = useOrders(status === 'all' ? undefined : status, page);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const customerName = useCustomerName();

  return (
    <div className="stack">
      <PageHeader title="Orders" subtitle="Customer orders — what's waiting on you, what's on its way, what's done." />
      <div className="split" data-detail={selected ? 'open' : undefined}>
        <Panel
          title="Customer orders"
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
                      <th>Placed</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th className="align-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <EmptyRow colSpan={4}>No orders here.</EmptyRow>}
                    {data.items.map((order) => (
                      <SelectableRow
                        key={order.id}
                        selected={selected === order.id}
                        onSelect={() => setSelected(order.id)}
                        label={`Order for ${customerName(order.customerId)}`}
                      >
                        <td>{formatDateTime(order.createdAt, timeZone)}</td>
                        <td>{customerName(order.customerId)}</td>
                        <td>{orderBadge(order)}</td>
                        <td className="align-right">
                          {order.totalValue ? formatMoney(order.totalValue, currency) : '—'}
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
        {selected && <OrderDetail key={selected} id={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
