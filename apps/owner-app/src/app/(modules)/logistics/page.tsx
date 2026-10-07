'use client';

import { useState } from 'react';
import type {
  CreateTripBody,
  ExpenseCategory,
  TripExpenseRecord,
  TripRecord,
  TripStatus,
  TripStopRecord,
} from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, FilterTabs, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import {
  useConfirmedOrders,
  useConfirmedPurchaseOrders,
  usePickups,
  useTripDetail,
  useTrips,
} from '@/lib/hooks/use-modules';
import {
  shortRef,
  useActiveDrivers,
  useActiveVehicles,
  useCurrency,
  useCustomerName,
  useEmployeeName,
  useFarmerName,
  useTenantProfile,
  useVehicleName,
} from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';
import { optionalText, parseMoney, parseOptionalMoney } from '@/lib/parse';
import { ClosedTrip, TripClosure } from '@/components/logistics/TripClosure';
import { useT } from '@/lib/i18n';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'in_progress' as const, label: 'On the road' },
  { value: 'planned' as const, label: 'Planned' },
  { value: 'completed' as const, label: 'To reconcile' },
  { value: 'on_hold' as const, label: 'On hold' },
  { value: 'reconciled' as const, label: 'Closed' },
  { value: 'cancelled' as const, label: 'Cancelled' },
];

const EXPENSE_LABEL: Record<ExpenseCategory, string> = { fuel: 'Fuel', toll: 'Toll', labour: 'Labour', other: 'Other' };

// Trips carry cash (Finance → Trip cash) and complete deliveries (orders,
// stock, receivables), so their actions refresh all of it.
const TRIP_EFFECTS = [KEYS.logistics, KEYS.orders, KEYS.procurement, KEYS.inventory, KEYS.finance, KEYS.dashboard];

// A submitted trip is done driving but still needs the owner's
// reconciliation — that's the owner's cue, so it reads as needing attention.
function tripBadge(trip: TripRecord) {
  if (trip.status === 'completed') return <StatusBadge status="completed" tone="attention" label="To reconcile" />;
  return <StatusBadge status={trip.status} />;
}

function tripDate(trip: TripRecord, timeZone: string): string {
  if (trip.startedAt) return formatDateTime(trip.startedAt, timeZone);
  if (trip.plannedDate) return formatDate(trip.plannedDate.slice(0, 10));
  return formatDateTime(trip.createdAt, timeZone);
}

// ---- New trip ----

function NewTripDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (trip: TripRecord) => void }) {
  const t = useT();
  const vehicles = useActiveVehicles();
  const drivers = useActiveDrivers();
  const currency = useCurrency();
  const [form, setForm] = useState({ vehicleId: '', driverId: '', date: '', advance: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const create = useAction(
    (body: CreateTripBody) => apiSend<TripRecord>('POST', 'logistics/trips', body),
    TRIP_EFFECTS,
    onCreated,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = () => {
    if (!form.vehicleId || !form.driverId) return setProblem(t('Choose the vehicle and the driver.'));
    const advance = parseOptionalMoney(form.advance, 'the cash advance');
    if (!advance.ok) return setProblem(advance.error);
    setProblem(null);
    create.mutate({
      vehicleId: form.vehicleId,
      driverEmployeeId: form.driverId,
      plannedDate: form.date || undefined,
      advanceAmount: advance.value,
    });
  };

  return (
    <FormDialog
      title={t('Plan a trip')}
      description={<p>Add pickups and deliveries to it next; the driver sees it in the driver app once it has stops.</p>}
      submitLabel={t('Plan trip')}
      pending={create.isPending}
      error={problem ?? create.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label={t('Vehicle')}>
        {(props) => (
          <select {...props} value={form.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
            <option value="">{vehicles.isPending ? 'Loading…' : 'Choose a vehicle…'}</option>
            {vehicles.records.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('Driver')}>
        {(props) => (
          <select {...props} value={form.driverId} onChange={(e) => set({ driverId: e.target.value })}>
            <option value="">{drivers.isPending ? 'Loading…' : 'Choose a driver…'}</option>
            {drivers.records.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('Date (optional)')}>
        {(props) => <input {...props} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}
      </Field>
      <Field label={`Cash advance (${currency}, optional)`} hint={t('Given to the driver for fuel, tolls, labour')}>
        {(props) => <input {...props} inputMode="decimal" value={form.advance} onChange={(e) => set({ advance: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}

// ---- Stops ----

function AddDeliveryDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
  const t = useT();
  const orders = useConfirmedOrders(true);
  const customerName = useCustomerName();
  const currency = useCurrency();
  const [orderId, setOrderId] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction(
    () => apiSend<TripStopRecord>('POST', `logistics/trips/${trip.id}/stops/delivery`, { orderId, notes: optionalText(notes) }),
    TRIP_EFFECTS,
    onClose,
  );
  return (
    <FormDialog
      title={t('Add a delivery')}
      description={<p>{t('Only confirmed orders — their stock is already reserved — can go on a trip.')}</p>}
      submitLabel={t('Add delivery')}
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (!orderId) return setProblem(t('Choose the order to deliver.'));
        setProblem(null);
        add.mutate(undefined);
      }}
    >
      <Field label={t('Order')} wide>
        {(props) => (
          <select {...props} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">
              {orders.isPending ? 'Loading…' : orders.data?.items.length ? 'Choose an order…' : 'No confirmed orders waiting'}
            </option>
            {(orders.data?.items ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {customerName(o.customerId)} · {o.totalValue ? formatMoney(o.totalValue, currency) : shortRef(o.id)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('Note for the driver (optional)')} wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function AddPickupDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
  const t = useT();
  const purchaseOrders = useConfirmedPurchaseOrders(true);
  const farmerName = useFarmerName();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [poId, setPoId] = useState('');
  const pickups = usePickups(poId || null);
  const [pickupId, setPickupId] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction(
    () =>
      apiSend<TripStopRecord>('POST', `logistics/trips/${trip.id}/stops/pickup`, { pickupId, notes: optionalText(notes) }),
    TRIP_EFFECTS,
    onClose,
  );
  const scheduled = (pickups.data ?? []).filter((p) => p.status === 'scheduled');

  return (
    <FormDialog
      title={t('Add a pickup')}
      description={<p>Pickups are scheduled on a confirmed purchase order (Procurement), then collected on a trip.</p>}
      submitLabel={t('Add pickup')}
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (!pickupId) return setProblem(t('Choose the scheduled pickup.'));
        setProblem(null);
        add.mutate(undefined);
      }}
    >
      <Field label={t('Purchase order')} wide>
        {(props) => (
          <select
            {...props}
            value={poId}
            onChange={(e) => {
              setPoId(e.target.value);
              setPickupId('');
            }}
          >
            <option value="">
              {purchaseOrders.isPending
                ? 'Loading…'
                : purchaseOrders.data?.items.length
                  ? 'Choose a purchase order…'
                  : 'No confirmed purchase orders'}
            </option>
            {(purchaseOrders.data?.items ?? []).map((po) => (
              <option key={po.id} value={po.id}>
                {farmerName(po.farmerId)} · raised {formatDateTime(po.createdAt, timeZone)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {poId && (
        <Field label={t('Pickup')} wide>
          {(props) => (
            <select {...props} value={pickupId} onChange={(e) => setPickupId(e.target.value)}>
              <option value="">
                {pickups.isPending
                  ? 'Loading…'
                  : scheduled.length
                    ? 'Choose a pickup…'
                    : 'None scheduled — schedule one from the purchase order first'}
              </option>
              {scheduled.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('Scheduled')} {formatDateTime(p.scheduledAt, timeZone)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={t('Note for the driver (optional)')} wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---- Money on the trip ----

function ExpenseDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
  const t = useT();
  const currency = useCurrency();
  const [category, setCategory] = useState<ExpenseCategory>('fuel');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const record = useAction(
    (body: { category: ExpenseCategory; amount: number; notes?: string }) =>
      apiSend<TripExpenseRecord>('POST', `logistics/trips/${trip.id}/expenses`, body),
    TRIP_EFFECTS,
    onClose,
  );
  return (
    <FormDialog
      title={t('Record a trip expense')}
      submitLabel={t('Record expense')}
      pending={record.isPending}
      error={problem ?? record.error}
      onClose={onClose}
      onSubmit={() => {
        const parsed = parseMoney(amount, 'the amount', true);
        if (!parsed.ok) return setProblem(parsed.error);
        setProblem(null);
        record.mutate({ category, amount: parsed.value, notes: optionalText(notes) });
      }}
    >
      <Field label={t('Category')}>
        {(props) => (
          <select {...props} value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {(Object.keys(EXPENSE_LABEL) as ExpenseCategory[]).map((c) => (
              <option key={c} value={c}>
                {EXPENSE_LABEL[c]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Amount (${currency})`}>
        {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label={t('Notes (optional)')} wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---- Detail ----

type Open = 'delivery' | 'pickup' | 'start' | 'complete' | 'cancel' | 'expense';

function TripDetail({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const t = useT();
  const { data, error, isPending, refetch } = useTripDetail(tripId);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();
  const { data: session } = useSession();
  const canDispatch = hasPermission(session, 'logistics:dispatch');
  const canWrite = hasPermission(session, 'logistics:write');
  const canReconcile = hasPermission(session, 'logistics:reconcile');
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);
  const transition = useAction(
    (step: 'start' | 'complete' | 'cancel') =>
      apiSend<TripRecord>('POST', `logistics/trips/${tripId}/${step}`, { version: data?.trip.version }),
    TRIP_EFFECTS,
    close,
  );

  if (isPending || error) {
    return (
      <DetailPanel title={t('Trip')} onClose={onClose}>
        {isPending ? <SkeletonLines lines={6} /> : <ErrorState error={error} onRetry={() => refetch()} />}
      </DetailPanel>
    );
  }

  const { trip, stops, expenses, reconciliation, deposits } = data;
  const pending = stops.filter((s) => s.status === 'pending').length;
  const active = trip.status === 'planned' || trip.status === 'in_progress';
  const confirmStep = (step: 'start' | 'complete' | 'cancel', title: string, body: React.ReactNode, label: string) => (
    <FormDialog
      title={title}
      description={body}
      submitLabel={label}
      tone={step === 'cancel' ? 'danger' : undefined}
      pending={transition.isPending}
      error={transition.error}
      onClose={() => {
        close();
        transition.reset();
      }}
      onSubmit={() => transition.mutate(step)}
    />
  );

  return (
    <DetailPanel title={`Trip · ${vehicleName(trip.vehicleId)}`} onClose={onClose}>
      <KeyValues
        items={[
          ['Driver', employeeName(trip.driverEmployeeId)],
          ['Status', tripBadge(trip)],
          ['Planned for', trip.plannedDate ? formatDate(trip.plannedDate.slice(0, 10)) : '—'],
          ['Started', formatDateTime(trip.startedAt, timeZone)],
          ['Finished', formatDateTime(trip.completedAt, timeZone)],
          ['Cash advance', formatMoney(trip.advanceAmount, currency)],
        ]}
      />
      {trip.status === 'in_progress' && trip.reviewNote && (
        <p className="action-note">{t('Returned to the driver:')} {trip.reviewNote}</p>
      )}
      {canReconcile && (trip.status === 'completed' || trip.status === 'on_hold') && <TripClosure trip={trip} deposits={deposits} />}
      <ActionBar>
        {canWrite && trip.status === 'planned' && (
          <button
            type="button"
            className="button button-primary"
            disabled={stops.length === 0}
            title={stops.length === 0 ? 'Add a stop first' : undefined}
            onClick={() => setOpen('start')}
          >
            {t('Start trip')}
          </button>
        )}
        {canWrite && trip.status === 'in_progress' && (
          <button
            type="button"
            className="button button-primary"
            disabled={pending > 0}
            title={pending > 0 ? `${pending} stop(s) still pending` : undefined}
            onClick={() => setOpen('complete')}
          >
            Complete trip
          </button>
        )}
        {canDispatch && trip.status === 'planned' && (
          <>
            <button type="button" className="button" onClick={() => setOpen('delivery')}>
              {t('Add delivery')}
            </button>
            <button type="button" className="button" onClick={() => setOpen('pickup')}>
              {t('Add pickup')}
            </button>
          </>
        )}
        {canWrite && (trip.status === 'planned' || trip.status === 'in_progress') && (
          <button type="button" className="button" onClick={() => setOpen('expense')}>
            {t('Record expense')}
          </button>
        )}
        {canWrite && active && (
          <button type="button" className="button button-danger" onClick={() => setOpen('cancel')}>
            {t('Cancel trip')}
          </button>
        )}
      </ActionBar>

      <h3 className="detail-subhead">
        {t('Stops ·')} {stops.length - pending} of {stops.length} done
      </h3>
      <ol className="stop-list">
        {stops.length === 0 && <li className="muted">{t('No stops planned yet.')}</li>}
        {stops.map((stop) => (
          <li key={stop.id} data-status={stop.status}>
            <span className="stop-seq">{stop.sequenceNumber}</span>
            <span>
              {stop.stopType === 'delivery'
                ? `Delivery · order ${shortRef(stop.orderId ?? '')}`
                : `Pickup · ${shortRef(stop.pickupId ?? '')}`}
              {stop.completedAt && <span className="muted"> · {formatDateTime(stop.completedAt, timeZone)}</span>}
              {stop.notes && <span className="muted"> · {stop.notes}</span>}
            </span>
            <StatusBadge status={stop.status} />
          </li>
        ))}
      </ol>
      {trip.status === 'in_progress' && pending > 0 && (
        <p className="footnote">
          {t('The driver completes each stop from the driver app, with proof of delivery and any cash collected.')}
        </p>
      )}

      <h3 className="detail-subhead">{t('Expenses')}</h3>
      {expenses.length === 0 ? (
        <p className="muted">{t('None recorded.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{EXPENSE_LABEL[expense.category]}</td>
                  <td className="muted">{expense.notes ?? ''}</td>
                  <td className="align-right">{formatMoney(expense.amount, currency)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={2}>{t('Total')}</td>
                <td className="align-right">{formatMoney(sumMoney(expenses.map((e) => e.amount)), currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {reconciliation && (
        <>
          <h3 className="detail-subhead">{t('Closure')}</h3>
          <ClosedTrip reconciliation={reconciliation} timeZone={timeZone} />
        </>
      )}
      {!reconciliation && !canReconcile && (trip.status === 'completed' || trip.status === 'on_hold') && (
        <p className="muted">{t('Waiting for the owner to reconcile and close.')}</p>
      )}

      {open === 'delivery' && <AddDeliveryDialog trip={trip} onClose={close} />}
      {open === 'pickup' && <AddPickupDialog trip={trip} onClose={close} />}
      {open === 'expense' && <ExpenseDialog trip={trip} onClose={close} />}
      {open === 'start' &&
        confirmStep(
          'start',
          'Start this trip?',
          <p>{t('Marks the vehicle as on the road with')} {stops.length} stop(s).</p>,
          'Start trip',
        )}
      {open === 'complete' &&
        confirmStep(
          'complete',
          'Complete this trip?',
          <p>{t('Every stop is done. It then waits for you to count the cash, check it and close it.')}</p>,
          'Complete trip',
        )}
      {open === 'cancel' &&
        confirmStep(
          'cancel',
          'Cancel this trip?',
          <p>{t("The orders and pickups on it stay confirmed and scheduled, ready to go on another trip. This can't be undone.")}</p>,
          'Cancel trip',
        )}
    </DetailPanel>
  );
}

export default function LogisticsPage() {
  const t = useT();
  const [status, setStatus] = useState<TripStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: session } = useSession();
  const canDispatch = hasPermission(session, 'logistics:dispatch');
  const { data, error, isPending, isPlaceholderData, refetch } = useTrips(status === 'all' ? undefined : status, page);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();

  return (
    <div className="stack">
      <PageHeader
        title={t('Trips')}
        subtitle={t('Deliveries and pickups on the road, and the cash each trip carried.')}
        actions={
          canDispatch && (
            <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
              {t('Plan a trip')}
            </button>
          )
        }
      />
      {creating && (
        <NewTripDialog
          onClose={() => setCreating(false)}
          onCreated={(trip) => {
            setCreating(false);
            setSelected(trip.id);
          }}
        />
      )}
      <div className="split" data-detail={selected ? 'open' : undefined}>
        <Panel
          title={t('Trips')}
          meta={
            <FilterTabs
              label={t('Filter by status')}
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
                      <th>{t('When')}</th>
                      <th>{t('Vehicle')}</th>
                      <th>{t('Driver')}</th>
                      <th>{t('Status')}</th>
                      <th className="align-right">{t('Advance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <EmptyRow colSpan={5}>{t('No trips here.')}</EmptyRow>}
                    {data.items.map((trip) => (
                      <SelectableRow
                        key={trip.id}
                        selected={selected === trip.id}
                        onSelect={() => setSelected(trip.id)}
                        label={`Trip on ${vehicleName(trip.vehicleId)}`}
                      >
                        <td>{tripDate(trip, timeZone)}</td>
                        <td>{vehicleName(trip.vehicleId)}</td>
                        <td>{employeeName(trip.driverEmployeeId)}</td>
                        <td>{tripBadge(trip)}</td>
                        <td className="align-right">{formatMoney(trip.advanceAmount, currency)}</td>
                      </SelectableRow>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </div>
          )}
        </Panel>
        {selected && <TripDetail key={selected} tripId={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
