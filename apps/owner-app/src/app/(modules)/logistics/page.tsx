'use client';

import { useState } from 'react';
import type {
  CreateTripBody,
  ExpenseCategory,
  ReconcileTripBody,
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
import { firstError, optionalText, parseMoney, parseOptionalMoney } from '@/lib/parse';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'in_progress' as const, label: 'On the road' },
  { value: 'planned' as const, label: 'Planned' },
  { value: 'completed' as const, label: 'To reconcile' },
  { value: 'reconciled' as const, label: 'Reconciled' },
  { value: 'cancelled' as const, label: 'Cancelled' },
];

const EXPENSE_LABEL: Record<ExpenseCategory, string> = { fuel: 'Fuel', toll: 'Toll', labour: 'Labour', other: 'Other' };

// Trips carry cash (Finance → Trip cash) and complete deliveries (orders,
// stock, receivables), so their actions refresh all of it.
const TRIP_EFFECTS = [KEYS.logistics, KEYS.orders, KEYS.procurement, KEYS.inventory, KEYS.finance, KEYS.dashboard];

// A completed trip is done driving but its cash still needs checking —
// that's the owner's cue, so it reads as needing attention here.
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
    if (!form.vehicleId || !form.driverId) return setProblem('Choose the vehicle and the driver.');
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
      title="Plan a trip"
      description={<p>Add pickups and deliveries to it next; the driver sees it in the driver app once it has stops.</p>}
      submitLabel="Plan trip"
      pending={create.isPending}
      error={problem ?? create.error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field label="Vehicle">
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
      <Field label="Driver">
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
      <Field label="Date (optional)">
        {(props) => <input {...props} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}
      </Field>
      <Field label={`Cash advance (${currency}, optional)`} hint="Given to the driver for fuel, tolls, labour">
        {(props) => <input {...props} inputMode="decimal" value={form.advance} onChange={(e) => set({ advance: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}

// ---- Stops ----

function AddDeliveryDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
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
      title="Add a delivery"
      description={<p>Only confirmed orders — their stock is already reserved — can go on a trip.</p>}
      submitLabel="Add delivery"
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (!orderId) return setProblem('Choose the order to deliver.');
        setProblem(null);
        add.mutate(undefined);
      }}
    >
      <Field label="Order" wide>
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
      <Field label="Note for the driver (optional)" wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function AddPickupDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
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
      title="Add a pickup"
      description={<p>Pickups are scheduled on a confirmed purchase order (Procurement), then collected on a trip.</p>}
      submitLabel="Add pickup"
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        if (!pickupId) return setProblem('Choose the scheduled pickup.');
        setProblem(null);
        add.mutate(undefined);
      }}
    >
      <Field label="Purchase order" wide>
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
        <Field label="Pickup" wide>
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
                  Scheduled {formatDateTime(p.scheduledAt, timeZone)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Note for the driver (optional)" wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---- Money on the trip ----

function ExpenseDialog({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
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
      title="Record a trip expense"
      submitLabel="Record expense"
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
      <Field label="Category">
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
      <Field label="Notes (optional)" wide>
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function ReconcileDialog({
  trip,
  expenses,
  onClose,
}: {
  trip: TripRecord;
  expenses: TripExpenseRecord[];
  onClose: () => void;
}) {
  const currency = useCurrency();
  const totalExpenses = sumMoney(expenses.map((e) => e.amount));
  const expected = sumMoney([trip.advanceAmount, `-${totalExpenses}`]);
  const [returned, setReturned] = useState(Number(expected) > 0 ? expected : '0.00');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reconcile = useAction(
    (body: ReconcileTripBody) => apiSend('POST', `logistics/trips/${trip.id}/reconcile`, body),
    TRIP_EFFECTS,
    onClose,
  );

  const parsed = parseMoney(returned, 'the cash returned');
  // Display-only preview; the backend computes and stores the variance.
  const variance = parsed.ok ? sumMoney([expected, `-${parsed.value.toFixed(2)}`]) : null;

  return (
    <FormDialog
      title="Reconcile the trip's cash"
      description={
        <p>
          Advance {formatMoney(trip.advanceAmount, currency)} − expenses {formatMoney(totalExpenses, currency)} ={' '}
          <strong>{formatMoney(expected, currency)}</strong> should come back. Customer collections on the trip are already
          recorded as payments under Finance and aren&apos;t part of this.
        </p>
      }
      submitLabel="Reconcile"
      pending={reconcile.isPending}
      error={problem ?? reconcile.error}
      onClose={onClose}
      onSubmit={() => {
        const error = firstError([parsed]);
        if (error) return setProblem(error);
        setProblem(null);
        reconcile.mutate({ version: trip.version, cashReturned: (parsed as { value: number }).value, notes: optionalText(notes) });
      }}
    >
      <Field
        label={`Cash handed back (${currency})`}
        hint={
          variance === null
            ? undefined
            : Number(variance) === 0
              ? 'Balanced'
              : Number(variance) > 0
                ? `${formatMoney(variance, currency)} short`
                : `${formatMoney(variance.replace('-', ''), currency)} over`
        }
      >
        {(props) => <input {...props} inputMode="decimal" value={returned} onChange={(e) => setReturned(e.target.value)} />}
      </Field>
      <Field label="Notes (optional)" hint="Especially if it doesn't balance">
        {(props) => <input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---- Detail ----

type Open = 'delivery' | 'pickup' | 'start' | 'complete' | 'cancel' | 'expense' | 'reconcile';

function TripDetail({ tripId, onClose }: { tripId: string; onClose: () => void }) {
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
      <DetailPanel title="Trip" onClose={onClose}>
        {isPending ? <SkeletonLines lines={6} /> : <ErrorState error={error} onRetry={() => refetch()} />}
      </DetailPanel>
    );
  }

  const { trip, stops, expenses, reconciliation } = data;
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
      <ActionBar>
        {canWrite && trip.status === 'planned' && (
          <button
            type="button"
            className="button button-primary"
            disabled={stops.length === 0}
            title={stops.length === 0 ? 'Add a stop first' : undefined}
            onClick={() => setOpen('start')}
          >
            Start trip
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
        {canReconcile && trip.status === 'completed' && (
          <button type="button" className="button button-primary" onClick={() => setOpen('reconcile')}>
            Reconcile cash
          </button>
        )}
        {canDispatch && trip.status === 'planned' && (
          <>
            <button type="button" className="button" onClick={() => setOpen('delivery')}>
              Add delivery
            </button>
            <button type="button" className="button" onClick={() => setOpen('pickup')}>
              Add pickup
            </button>
          </>
        )}
        {canWrite && trip.status !== 'cancelled' && trip.status !== 'reconciled' && (
          <button type="button" className="button" onClick={() => setOpen('expense')}>
            Record expense
          </button>
        )}
        {canWrite && active && (
          <button type="button" className="button button-danger" onClick={() => setOpen('cancel')}>
            Cancel trip
          </button>
        )}
      </ActionBar>

      <h3 className="detail-subhead">
        Stops · {stops.length - pending} of {stops.length} done
      </h3>
      <ol className="stop-list">
        {stops.length === 0 && <li className="muted">No stops planned yet.</li>}
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
          The driver completes each stop from the driver app, with proof of delivery and any cash collected.
        </p>
      )}

      <h3 className="detail-subhead">Expenses</h3>
      {expenses.length === 0 ? (
        <p className="muted">None recorded.</p>
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
                <td colSpan={2}>Total</td>
                <td className="align-right">{formatMoney(sumMoney(expenses.map((e) => e.amount)), currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h3 className="detail-subhead">Cash reconciliation</h3>
      {reconciliation ? (
        <KeyValues
          items={[
            ['Advance', formatMoney(reconciliation.advanceAmount, currency)],
            ['Expenses', formatMoney(reconciliation.totalExpenses, currency)],
            ['Cash returned', formatMoney(reconciliation.cashReturned, currency)],
            [
              'Variance',
              Number(reconciliation.variance) === 0 ? (
                <StatusBadge status="balanced" tone="done" label="Balanced" />
              ) : (
                <StatusBadge
                  status="short"
                  tone="bad"
                  label={`${formatMoney(reconciliation.variance.replace('-', ''), currency)} ${
                    Number(reconciliation.variance) > 0 ? 'short' : 'over'
                  }`}
                />
              ),
            ],
            ['Reconciled', formatDateTime(reconciliation.reconciledAt, timeZone)],
          ]}
        />
      ) : (
        <p className="muted">
          {trip.status === 'completed'
            ? 'Not reconciled yet — the driver’s advance still needs to be checked against expenses and cash returned.'
            : 'Reconciled once the trip is completed.'}
        </p>
      )}

      {open === 'delivery' && <AddDeliveryDialog trip={trip} onClose={close} />}
      {open === 'pickup' && <AddPickupDialog trip={trip} onClose={close} />}
      {open === 'expense' && <ExpenseDialog trip={trip} onClose={close} />}
      {open === 'reconcile' && <ReconcileDialog trip={trip} expenses={expenses} onClose={close} />}
      {open === 'start' &&
        confirmStep(
          'start',
          'Start this trip?',
          <p>Marks the vehicle as on the road with {stops.length} stop(s).</p>,
          'Start trip',
        )}
      {open === 'complete' &&
        confirmStep('complete', 'Complete this trip?', <p>Every stop is done. The trip&apos;s cash is then reconciled.</p>, 'Complete trip')}
      {open === 'cancel' &&
        confirmStep(
          'cancel',
          'Cancel this trip?',
          <p>The orders and pickups on it stay confirmed and scheduled, ready to go on another trip. This can&apos;t be undone.</p>,
          'Cancel trip',
        )}
    </DetailPanel>
  );
}

export default function LogisticsPage() {
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
        title="Trips"
        subtitle="Deliveries and pickups on the road, and the cash each trip carried."
        actions={
          canDispatch && (
            <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
              Plan a trip
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
          title="Trips"
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
                      <th>When</th>
                      <th>Vehicle</th>
                      <th>Driver</th>
                      <th>Status</th>
                      <th className="align-right">Advance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <EmptyRow colSpan={5}>No trips here.</EmptyRow>}
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
