'use client';

import { useState } from 'react';
import type { CreateOrderBody, OrderRecord, OrderStatus } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, FilterTabs, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { ApprovalGate } from '@/components/forms/ApprovalGate';
import { emptyLine, LinesEditor, parseLines, type LineDraft } from '@/components/forms/LinesEditor';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCustomerCredit, useOrder, useOrders } from '@/lib/hooks/use-modules';
import {
  useActiveCustomers,
  useActiveProducts,
  useCurrency,
  useCustomerName,
  useProductName,
  useProductUom,
  useTenantProfile,
} from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'placed' as const, label: 'To confirm' },
  { value: 'confirmed' as const, label: 'Confirmed' },
  { value: 'delivered' as const, label: 'Delivered' },
  { value: 'cancelled' as const, label: 'Cancelled' },
];

// An order's actions move stock (reservation), receivables (delivery), and
// the dashboard's figures, so each one refreshes all of them.
const ORDER_EFFECTS = [KEYS.orders, KEYS.inventory, KEYS.finance, KEYS.dashboard];

// A placed order carrying an approval request is waiting on a decision,
// not on the person who took it — show that difference.
function orderBadge(order: OrderRecord) {
  if (order.status === 'placed' && order.approvalRequestId) return <StatusBadge status="awaiting_approval" />;
  return <StatusBadge status={order.status} />;
}

// ---- New order ----

function CreditHint({ customerId }: { customerId: string }) {
  const { data: session } = useSession();
  const { data } = useCustomerCredit(customerId, hasPermission(session, 'finance:read'));
  if (!data) return null;
  if (data.creditHold) {
    return (
      <p className="action-note form-wide" data-tone="bad">
        <strong>On credit hold</strong>
        {data.creditHoldReason ? ` — ${data.creditHoldReason}` : ''}. New orders for this customer can be placed but
        won&apos;t confirm until the hold is lifted.
      </p>
    );
  }
  const available = Number(data.available);
  return (
    <p className="action-note form-wide" data-tone={available <= 0 ? 'bad' : 'info'}>
      Credit available: <strong>{formatMoney(data.available, data.currency)}</strong> of{' '}
      {formatMoney(data.creditLimit, data.currency)} (owes {formatMoney(data.balance, data.currency)}, plus{' '}
      {formatMoney(data.openOrderValue, data.currency)} confirmed and not yet delivered). The order is checked against
      this when it&apos;s confirmed.
    </p>
  );
}

function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (order: OrderRecord) => void }) {
  const customers = useActiveCustomers();
  const products = useActiveProducts();
  const currency = useCurrency();
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useAction(
    (body: CreateOrderBody) => apiSend<OrderRecord>('POST', 'orders', body),
    ORDER_EFFECTS,
    onCreated,
  );

  const submit = () => {
    if (!customerId) return setProblem('Choose the customer.');
    const parsed = parseLines(lines, true);
    if (!parsed.ok) return setProblem(parsed.error);
    setProblem(null);
    create.mutate({
      customerId,
      lines: parsed.value.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.price })),
    });
  };

  return (
    <FormDialog
      title="New customer order"
      description={<p>Leave a rate blank to use the product&apos;s list price. The order is placed now and confirmed separately.</p>}
      submitLabel="Place order"
      size="wide"
      pending={create.isPending}
      error={problem ?? create.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Customer" wide>
        {(props) => (
          <select {...props} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">{customers.isPending ? 'Loading…' : 'Choose a customer…'}</option>
            {customers.records.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {customerId && <CreditHint customerId={customerId} />}
      <LinesEditor
        lines={lines}
        onChange={setLines}
        products={products.records}
        currency={currency}
        priceLabel="Rate"
        priceOptional
      />
    </FormDialog>
  );
}

// ---- Detail ----

function OrderActions({ order, canWrite }: { order: OrderRecord; canWrite: boolean }) {
  const [open, setOpen] = useState<'confirm' | 'cancel' | null>(null);
  const close = () => setOpen(null);
  const confirm = useAction(
    () => apiSend<OrderRecord>('POST', `orders/${order.id}/confirm`, { version: order.version }),
    ORDER_EFFECTS,
    close,
  );
  const cancel = useAction(
    () => apiSend<OrderRecord>('POST', `orders/${order.id}/cancel`, { version: order.version }),
    ORDER_EFFECTS,
    close,
  );

  if (!canWrite || order.status === 'delivered' || order.status === 'cancelled') return null;
  const awaiting = order.status === 'placed' && order.approvalRequestId !== null;

  return (
    <>
      <ActionBar>
        {order.status === 'placed' && !awaiting && (
          <button type="button" className="button button-primary" onClick={() => setOpen('confirm')}>
            Confirm order
          </button>
        )}
        <button type="button" className="button button-danger" onClick={() => setOpen('cancel')}>
          Cancel order
        </button>
      </ActionBar>
      {open === 'confirm' && (
        <FormDialog
          title="Confirm this order?"
          description={
            <>
              <p>Confirming checks the customer&apos;s credit and reserves a graded stock lot for every line.</p>
              <p>If the order is over your approval threshold, it goes for approval instead.</p>
            </>
          }
          submitLabel="Confirm order"
          pending={confirm.isPending}
          error={confirm.error}
          onClose={close}
          onSubmit={() => confirm.mutate(undefined)}
        />
      )}
      {open === 'cancel' && (
        <FormDialog
          title="Cancel this order?"
          description={
            order.status === 'confirmed' ? (
              <p>The stock lots reserved for it go back to being available. This can&apos;t be undone.</p>
            ) : (
              <p>This can&apos;t be undone.</p>
            )
          }
          submitLabel="Cancel order"
          tone="danger"
          pending={cancel.isPending}
          error={cancel.error}
          onClose={close}
          onSubmit={() => cancel.mutate(undefined)}
        />
      )}
    </>
  );
}

function OrderDetail({ id, canWrite, onClose }: { id: string; canWrite: boolean; onClose: () => void }) {
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
          {data.status === 'placed' && data.approvalRequestId && (
            <ApprovalGate
              requestId={data.approvalRequestId}
              subject="order"
              currency={currency}
              timeZone={timeZone}
              canFinalize={canWrite}
              finalizePath={`orders/${data.id}/finalize-confirmation`}
              invalidates={ORDER_EFFECTS}
            />
          )}
          <OrderActions order={data} canWrite={canWrite} />
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
                      {/* Display only — the order total in the list comes from the server. */}
                      {formatMoney(String(Number(line.quantity) * Number(line.unitPrice)), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            An order is delivered from a trip&apos;s delivery stop (Trips). Delivery consumes the reserved stock and issues
            the invoice, which then shows under Finance → Receivables.
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
  const [creating, setCreating] = useState(false);
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'orders:write');
  const { data, error, isPending, isPlaceholderData, refetch } = useOrders(status === 'all' ? undefined : status, page);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const customerName = useCustomerName();

  return (
    <div className="stack">
      <PageHeader
        title="Orders"
        subtitle="Customer orders — what's waiting on you, what's on its way, what's done."
        actions={
          canWrite && (
            <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
              New order
            </button>
          )
        }
      />
      {creating && (
        <NewOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            setSelected(order.id);
          }}
        />
      )}
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
        {selected && <OrderDetail key={selected} id={selected} canWrite={canWrite} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
