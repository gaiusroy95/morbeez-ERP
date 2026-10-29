'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  CreatedOrder,
  CreateOrderBody,
  CustomerRecord,
  OrderCard,
  OrderRecord,
  OrdersBoardDay,
  OrderStage,
  PriceSuggestion,
} from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { ApprovalGate } from '@/components/forms/ApprovalGate';
import { emptyLine, LinesEditor, parseLines, withProduct, type LineDraft } from '@/components/forms/LinesEditor';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useCustomerCredit, useOrder } from '@/lib/hooks/use-modules';
import {
  useActiveCustomers,
  useActiveDrivers,
  useActiveProducts,
  useActiveVehicles,
  useCurrency,
  useCustomerName,
  useEmployeeName,
  useProductName,
  useProductUom,
  useTenantProfile,
  useVehicleName,
} from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { QuickAddCustomer, QuickAddProduct, QuickAddRoute, useCanAdd } from '@/components/forms/QuickAdd';
import { SearchSelect } from '@/components/forms/SearchSelect';
import { clock, formatDate, formatDateTime, formatMoney, formatQuantity, todayIn } from '@/lib/format';
import { optionalText } from '@/lib/parse';
import { useT } from '@/lib/i18n';
import { useOpenOnNew } from '@/lib/hooks/use-open-on-new';
import { formatOrderNumber, useOrdersBoard, useRouteName, useRoutes } from '@/lib/hooks/use-delivery-orders';
import { CreateBar, DayTabs, ListCard, SearchFilter, type CardTone } from '@/components/redesign/ListCards';

// An order's actions move stock (reservation), receivables (delivery), and
// the dashboard's figures, so each one refreshes all of them.
const ORDER_EFFECTS = [KEYS.orders, KEYS.inventory, KEYS.finance, KEYS.dashboard];

// A placed order carrying an approval request is waiting on a decision,
// not on the person who took it — show that difference.
function orderBadge(order: OrderRecord) {
  if (order.status === 'placed' && order.approvalRequestId) return <StatusBadge status="awaiting_approval" />;
  return <StatusBadge status={order.status} />;
}

/** Credit terms offered on an order, in days. */
const CREDIT_TERMS = [0, 7, 15, 30, 45, 60, 90];

// ---- New order ----

function CreditHint({ customerId }: { customerId: string }) {
  const t = useT();
  const { data: session } = useSession();
  const { data } = useCustomerCredit(customerId, hasPermission(session, 'finance:read'));
  if (!data) return null;
  if (data.creditHold) {
    return (
      <p className="action-note form-wide" data-tone="bad">
        <strong>{t('On credit hold')}</strong>
        {data.creditHoldReason ? ` — ${data.creditHoldReason}` : ''}. New orders for this customer can be placed but
        won&apos;t confirm until the hold is lifted.
      </p>
    );
  }
  const available = Number(data.available);
  return (
    <p className="action-note form-wide" data-tone={available <= 0 ? 'bad' : 'info'}>
      Credit available: <strong>{formatMoney(data.available, data.currency)}</strong> {t('of')}{' '}
      {formatMoney(data.creditLimit, data.currency)} (owes {formatMoney(data.balance, data.currency)}, plus{' '}
      {formatMoney(data.openOrderValue, data.currency)} confirmed and not yet delivered). The order is checked against
      this when it&apos;s confirmed.
    </p>
  );
}

/**
 * "Create Delivery Order" (client design V1.1, screen 6): customer (with a
 * card and View), route, delivery date and time, driver and vehicle,
 * products, the delivery address ("Use Default" = the customer's own), a
 * credit term, notes. "Save Order" confirms it straight away when the
 * customer's credit and the stock allow; otherwise it's saved to confirm
 * later, and the reason is shown.
 */
function NewOrderDialog({
  onClose,
  onCreated,
  initialCustomerId = '',
}: {
  onClose: () => void;
  onCreated: (order: CreatedOrder) => void;
  /** "New Order" on a customer's profile: who it's for. */
  initialCustomerId?: string;
}) {
  const t = useT();
  const customers = useActiveCustomers();
  const products = useActiveProducts();
  const drivers = useActiveDrivers();
  const vehicles = useActiveVehicles();
  const routes = useRoutes();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const { data: session } = useSession();
  const mayExtendCredit = hasPermission(session, 'customers:credit');
  const [form, setForm] = useState({
    customerId: initialCustomerId,
    routeId: '',
    date: todayIn(timeZone),
    time: '',
    driverId: '',
    vehicleId: '',
    address: '',
    creditTerm: '',
    notes: '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [addingCustomer, setAddingCustomer] = useState<string | null>(null);
  const canAddCustomer = useCanAdd('customers');
  const [addingRoute, setAddingRoute] = useState<string | null>(null);
  const [addingProduct, setAddingProduct] = useState<{ lineKey: number; name: string } | null>(null);
  const canAddProduct = useCanAdd('products');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [problem, setProblem] = useState<string | null>(null);
  const customer = customers.records.find((c) => c.id === form.customerId);
  // Opened for a customer: their route and address once the list has loaded.
  const [prefilled, setPrefilled] = useState(!initialCustomerId);
  if (!prefilled && customer) {
    setPrefilled(true);
    setForm((f) => ({ ...f, routeId: f.routeId || customer.routeId || '', address: f.address || customer.address || '' }));
  }
  // The last actual price for this customer and each chosen product (client Q&A, pricing).
  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))].sort();
  const suggestions = useQuery({
    queryKey: ['orders', 'price-suggestions', form.customerId, productIds.join(',')],
    queryFn: () => apiGet<PriceSuggestion[]>('orders/price-suggestions', { customerId: form.customerId, productIds: productIds.join(',') }),
    enabled: !!form.customerId && productIds.length > 0,
    staleTime: 60_000,
  });
  const hints = useMemo(() => new Map((suggestions.data ?? []).map((s) => [s.productId, s])), [suggestions.data]);
  const create = useAction((body: CreateOrderBody) => apiSend<CreatedOrder>('POST', 'orders', body), ORDER_EFFECTS, onCreated);
  const activeRoutes = (routes.data ?? []).filter((r) => r.status === 'active');
  const usualTerm = customer?.paymentTermsDays ?? 0;
  // Longer than the customer's usual terms is extending credit (customers:credit).
  const terms = CREDIT_TERMS.filter((d) => d !== usualTerm && (mayExtendCredit || d < usualTerm));

  const chooseCustomer = (c: CustomerRecord | undefined) =>
    set({
      customerId: c?.id ?? '',
      // The customer's own route and address, unless something was already chosen.
      routeId: form.routeId || c?.routeId || '',
      address: form.address || c?.address || '',
      creditTerm: '',
    });

  const submit = () => {
    if (!form.customerId) return setProblem(t('Choose the customer.'));
    if (!form.date) return setProblem(t('Choose the delivery date.'));
    if (!form.driverId || !form.vehicleId) return setProblem(t('Choose the driver and the vehicle.'));
    const parsed = parseLines(lines, true, products.records);
    if (!parsed.ok) return setProblem(parsed.error);
    setProblem(null);
    create.mutate({
      customerId: form.customerId,
      routeId: form.routeId || undefined,
      deliveryDate: form.date,
      deliveryTime: form.time || undefined,
      driverEmployeeId: form.driverId,
      vehicleId: form.vehicleId,
      deliveryAddress: optionalText(form.address),
      creditTermDays: form.creditTerm === '' ? undefined : Number(form.creditTerm),
      notes: optionalText(form.notes),
      confirm: true,
      lines: parsed.value.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.price })),
    });
  };

  return (
    <>
      <FormDialog
        title={t('Create Delivery Order')}
        description={
          <p>
            {t("Each rate starts at the last price this customer paid (or the product's last selling price); change it if today's deal differs.")}
          </p>
        }
        submitLabel={t('Save Order')}
        size="wide"
        pending={create.isPending}
        error={problem ?? create.error}
        onClose={onClose}
        onSubmit={submit}
      >
        <Field label={t('Customer')} wide>
          {(props) => (
            <SearchSelect
              {...props}
              value={form.customerId}
              onChange={(id) => chooseCustomer(customers.records.find((c) => c.id === id))}
              loading={customers.isPending}
              placeholder={t('Choose a customer…')}
              searchPlaceholder={t('Search by name or phone…')}
              options={customers.records.map((c) => ({ value: c.id, label: c.name, sub: c.place ?? c.contact?.phone }))}
              createLabel={canAddCustomer ? t('Create new customer') : undefined}
              onCreate={canAddCustomer ? (typed) => setAddingCustomer(typed) : undefined}
            />
          )}
        </Field>
        {customer && (
          <div className="farmer-card form-wide">
            <span className="list-card-badge" aria-hidden="true">
              {customer.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="farmer-card-text">
              <strong>{customer.name}</strong>
              {customer.place && <span>{customer.place}</span>}
              {customer.contact?.phone && <span>{customer.contact.phone}</span>}
            </span>
            <a className="button button-small" href="/customers" target="_blank" rel="noopener noreferrer">
              {t('View')}
            </a>
          </div>
        )}
        {form.customerId && <CreditHint customerId={form.customerId} />}
        <Field label={t('Route')}>
          {(props) => (
            <SearchSelect
              {...props}
              value={form.routeId}
              onChange={(routeId) => set({ routeId })}
              loading={routes.isPending}
              placeholder={t('Choose a route…')}
              searchPlaceholder={t('Search routes…')}
              options={[{ value: '', label: t('No route') }, ...activeRoutes.map((r) => ({ value: r.id, label: r.name }))]}
              createLabel={t('Create new route')}
              onCreate={(typed) => setAddingRoute(typed)}
            />
          )}
        </Field>
        <Field label={t('Delivery Date')}>
          {(props) => <input {...props} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}
        </Field>
        <Field label={t('Delivery time (optional)')}>
          {(props) => <input {...props} type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />}
        </Field>
        <Field label={t('Credit Term')}>
          {(props) => (
            <select {...props} value={form.creditTerm} onChange={(e) => set({ creditTerm: e.target.value })}>
              <option value="">
                {customer ? t('Usual ({days} days)', { days: usualTerm }) : t('Usual terms')}
              </option>
              {terms.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? t('Pays on delivery') : t('{days} days', { days: d })}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('Driver')}>
          {(props) => (
            <select {...props} value={form.driverId} onChange={(e) => set({ driverId: e.target.value })}>
              <option value="">{drivers.isPending ? t('Loading…') : t('Choose a driver…')}</option>
              {drivers.records.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('Vehicle')}>
          {(props) => (
            <select {...props} value={form.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
              <option value="">{vehicles.isPending ? t('Loading…') : t('Choose a vehicle…')}</option>
              {vehicles.records.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="form-section-title form-wide">{t('Products')}</p>
        <LinesEditor
          lines={lines}
          onChange={setLines}
          products={products.records}
          onAddProduct={canAddProduct ? (lineKey, name) => setAddingProduct({ lineKey, name }) : undefined}
          currency={currency}
          priceLabel={t('Rate (₹/kg)')}
          priceOptional
          hints={form.customerId ? hints : undefined}
        />
        <div className="field" data-wide>
          <div className="field-label-row">
            <label htmlFor="delivery-address">{t('Delivery Address')}</label>
            <button
              type="button"
              className="link-button"
              disabled={!customer?.address}
              title={customer && !customer.address ? t('No address saved for this customer') : undefined}
              onClick={() => set({ address: customer?.address ?? '' })}
            >
              {t('Use Default')}
            </button>
          </div>
          <input
            id="delivery-address"
            maxLength={300}
            placeholder={t('Where to deliver')}
            value={form.address}
            onChange={(e) => set({ address: e.target.value })}
          />
        </div>
        <Field label={t('Notes (optional)')} wide>
          {(props) => <textarea {...props} maxLength={500} placeholder={t('Enter notes…')} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
        </Field>
      </FormDialog>
      {addingProduct && (
        <QuickAddProduct
          initialName={addingProduct.name}
          onClose={() => setAddingProduct(null)}
          onAdded={(product) => {
            setLines((current) => withProduct(current, addingProduct.lineKey, product));
            setAddingProduct(null);
          }}
        />
      )}
      {addingCustomer !== null && (
        <QuickAddCustomer
          initialName={addingCustomer}
          onClose={() => setAddingCustomer(null)}
          onAdded={(c) => {
            chooseCustomer(c);
            setAddingCustomer(null);
          }}
        />
      )}
      {addingRoute !== null && (
        <QuickAddRoute
          initialName={addingRoute}
          onClose={() => setAddingRoute(null)}
          onAdded={(route) => {
            set({ routeId: route.id });
            setAddingRoute(null);
          }}
        />
      )}
    </>
  );
}

// ---- Detail ----

function OrderActions({ order, canWrite }: { order: OrderRecord; canWrite: boolean }) {
  const t = useT();
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
            {t('Confirm order')}
          </button>
        )}
        <button type="button" className="button button-danger" onClick={() => setOpen('cancel')}>
          {t('Cancel order')}
        </button>
      </ActionBar>
      {open === 'confirm' && (
        <FormDialog
          title={t('Confirm this order?')}
          description={
            <>
              <p>{t("Confirming checks the customer's credit and reserves a graded stock lot for every line.")}</p>
              <p>{t('If the order is over your approval threshold, it goes for approval instead.')}</p>
            </>
          }
          submitLabel={t('Confirm order')}
          pending={confirm.isPending}
          error={confirm.error}
          onClose={close}
          onSubmit={() => confirm.mutate(undefined)}
        />
      )}
      {open === 'cancel' && (
        <FormDialog
          title={t('Cancel this order?')}
          description={
            order.status === 'confirmed' ? (
              <p>{t("The stock lots reserved for it go back to being available. This can't be undone.")}</p>
            ) : (
              <p>{t("This can't be undone.")}</p>
            )
          }
          submitLabel={t('Cancel order')}
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
  const t = useT();
  const { data, error, isPending, refetch } = useOrder(id);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const customerName = useCustomerName();
  const productName = useProductName();
  const productUom = useProductUom();
  const employeeName = useEmployeeName();
  const vehicleName = useVehicleName();
  const routeName = useRouteName();

  return (
    <DetailPanel title={data ? `${formatOrderNumber(data.number)} · ${customerName(data.customerId)}` : t('Order')} onClose={onClose}>
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
              ['Delivery', data.deliveryDate ? `${formatDate(data.deliveryDate)}${data.deliveryTime ? ` · ${clock(data.deliveryTime)}` : ''}` : '—'],
              ['Route', routeName(data.routeId)],
              ['Driver', data.plannedDriverId ? employeeName(data.plannedDriverId) : '—'],
              ['Vehicle', data.plannedVehicleId ? vehicleName(data.plannedVehicleId) : '—'],
              ['Deliver to', data.deliveryAddress ?? '—'],
              ['Credit term', data.creditTermDays === null ? t('Usual terms') : data.creditTermDays === 0 ? t('Pays on delivery') : t('{days} days', { days: data.creditTermDays })],
              ['Placed', formatDateTime(data.createdAt, timeZone)],
              ...(data.notes ? ([['Notes', data.notes]] as [string, string][]) : []),
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
          <h3 className="detail-subhead">{t('Products')}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th className="align-right">{t('Quantity')}</th>
                  <th className="align-right">{t('Rate')}</th>
                  <th className="align-right">{t('Value')}</th>
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
            {t("An order is delivered from a trip's delivery stop (Trips). Delivery consumes the reserved stock and issues the invoice, which then shows under Finance → Receivables.")}
          </p>
        </>
      )}
    </DetailPanel>
  );
}

// ---- The list ----

const STAGE: Record<OrderStage, { label: string; tone: CardTone }> = {
  pending: { label: 'Pending', tone: 'pending' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'pending' },
  scheduled: { label: 'Scheduled', tone: 'progress' },
  in_transit: { label: 'In Transit', tone: 'progress' },
  completed: { label: 'Completed', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

const STAGE_FILTER = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** "Ginger 400 kg", "+1 more". */
function productSummary(card: OrderCard): string {
  const first = card.products[0];
  if (!first) return '';
  return `${first.name} ${formatQuantity(first.quantity)} ${first.uom}${card.products.length > 1 ? ` · +${card.products.length - 1}` : ''}`;
}

/** The Delivery Orders list (client design V1.1, screen 5). */
export default function OrdersPage() {
  const t = useT();
  const [day, setDay] = useState<OrdersBoardDay>('today');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [forCustomer, setForCustomer] = useState('');
  useOpenOnNew((params) => {
    setForCustomer(params.get('customer') ?? '');
    setCreating(true);
  });
  const { data: session } = useSession();
  const canWrite = hasPermission(session, 'orders:write');
  const board = useOrdersBoard(day, query);
  const cards = (board.data?.items ?? []).filter((c) => stage === 'all' || c.stage === stage);
  const counts = board.data?.counts;

  return (
    <div className="list-split">
      <div className="list-screen">
        <h1 className="page-title visually-hidden">{t('Delivery Orders')}</h1>
        {creating && (
          <NewOrderDialog
            initialCustomerId={forCustomer}
            onClose={() => {
              setCreating(false);
              setForCustomer('');
            }}
            onCreated={(order) => {
              setCreating(false);
              setForCustomer('');
              setSelected(order.id);
              setNotice(
                order.confirmProblem
                  ? t('{number} is saved but not confirmed yet: {reason} Confirm it from the order once that is sorted.', {
                      number: formatOrderNumber(order.number),
                      reason: order.confirmProblem,
                    })
                  : null,
              );
            }}
          />
        )}
        {notice && (
          <p className="action-note" data-tone="bad" role="status">
            {notice}{' '}
            <button type="button" className="link-button" onClick={() => setNotice(null)}>
              {t('Dismiss')}
            </button>
          </p>
        )}
        <DayTabs
          label="Which day"
          value={day}
          onChange={(value) => {
            setDay(value);
            setSelected(null);
          }}
          options={[
            { value: 'today', label: 'Today', count: counts?.today },
            { value: 'tomorrow', label: 'Tomorrow', count: counts?.tomorrow },
            { value: 'all', label: 'All', count: counts?.all },
          ]}
        />
        <SearchFilter
          value={query}
          onChange={setQuery}
          placeholder="Search customer, product…"
          filter={{ value: stage, options: STAGE_FILTER, onChange: setStage, label: 'Filter by status' }}
        />
        {board.isPending ? (
          <SkeletonLines lines={5} height={64} />
        ) : board.error ? (
          <div className="panel">
            <ErrorState error={board.error} onRetry={() => board.refetch()} />
          </div>
        ) : (
          <div className="card-list" data-updating={board.isPlaceholderData || undefined}>
            {cards.length === 0 && (
              <div className="list-empty">{query || stage !== 'all' ? t('Nothing matches.') : t('No deliveries for this day.')}</div>
            )}
            {cards.map((card) => (
              <ListCard
                key={card.id}
                number={formatOrderNumber(card.number)}
                title={card.customerName}
                place={card.customerPlace ?? card.routeName}
                detail={productSummary(card)}
                time={clock(card.deliveryTime)}
                status={STAGE[card.stage].label}
                tone={STAGE[card.stage].tone}
                person={card.driverName}
                vehicle={card.vehicle}
                initial={card.customerName}
                selected={selected === card.id}
                onOpen={() => setSelected(card.id)}
              />
            ))}
          </div>
        )}
        {canWrite && <CreateBar label="Create Delivery Order" onClick={() => setCreating(true)} />}
      </div>
      {selected && <OrderDetail key={selected} id={selected} canWrite={canWrite} onClose={() => setSelected(null)} />}
    </div>
  );
}
