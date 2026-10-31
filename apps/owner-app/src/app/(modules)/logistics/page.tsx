'use client';

import { useState } from 'react';
import Link from 'next/link';
import type {
  ExpenseCategory,
  OrderRecord,
  TripCard,
  TripExpenseRecord,
  TripRecord,
  TripStatus,
  TripStopRecord,
  TripsBoardDay,
} from '@morbeez/shared-types';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FilterTabs } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useConfirmedOrders, useConfirmedPurchaseOrders, usePickups, useTripDetail } from '@/lib/hooks/use-modules';
import { useCurrency, useCustomerName, useEmployeeName, useFarmerName, useTenantProfile, useVehicleName } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { clock, formatDate, formatDateTime, formatMoney, formatQuantity, formatRate, timeOf } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';
import { optionalText, parseMoney } from '@/lib/parse';
import { ClosedTrip, TripClosure } from '@/components/logistics/TripClosure';
import { CreateTripDialog } from '@/components/logistics/CreateTrip';
import { navigateUrl, TripMap, tripDistance, useTripPoints } from '@/components/logistics/TripMap';
import { TripQuantitiesView } from '@/components/logistics/TripQuantities';
import { TripBackhaulView } from '@/components/logistics/TripBackhaul';
import { CreateBar, DayTabs, ListCard, SearchFilter, type CardTone } from '@/components/redesign/ListCards';
import { useT, type Translate } from '@/lib/i18n';
import { useOpenOnNew, useOpenParam } from '@/lib/hooks/use-open-on-new';
import { formatPoNumber } from '@/lib/hooks/use-procurement';
import { formatOrderNumber, useRouteName } from '@/lib/hooks/use-delivery-orders';
import { useTripsBoard } from '@/lib/hooks/use-trips';
import { useTripIncentives } from '@/lib/hooks/use-admin';
import { TripIncentivesView } from '@/components/people/DriverIncentives';

const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  fuel: 'Fuel',
  toll: 'Toll',
  parking: 'Parking',
  labour: 'Loading labour',
  repair: 'Repair',
  other: 'Other',
};

/** What the driver recorded beside the amount (driver app D6): the pump's details, the bill, the owner's decision. */
function expenseFacts(e: TripExpenseRecord, currency: string, t: Translate): string[] {
  const facts: string[] = [];
  const fuel = e.fuel;
  if (fuel?.litres && fuel.ratePerLitre) {
    facts.push(
      [
        t('{litres} L at {rate} a litre', { litres: formatQuantity(fuel.litres), rate: formatRate(fuel.ratePerLitre, currency) }),
        fuel.fullTank === false ? t('Part fill') : t('Full tank'),
        fuel.odometerKm !== null ? t('{km} km on the odometer', { km: fuel.odometerKm.toLocaleString('en-IN') }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (e.photos) facts.push(e.photos === 1 ? t('Bill photo') : t('{n} bill photos', { n: e.photos }));
  if (e.needsApproval) {
    facts.push(
      e.decision === 'approved'
        ? t('Approved')
        : e.decision === 'rejected'
          ? t('Rejected: {note}', { note: e.decisionNote ?? '' })
          : t('Beyond the driver’s authority — waiting for your approval'),
    );
  }
  return facts;
}

// Trips carry cash (Finance → Trip cash) and complete deliveries (orders,
// stock, receivables), so their actions refresh all of it.
const TRIP_EFFECTS = [KEYS.logistics, KEYS.orders, KEYS.procurement, KEYS.inventory, KEYS.finance, KEYS.dashboard];

// A submitted trip is done driving but still needs the owner's
// reconciliation — that's the owner's cue, so it reads as needing attention.
function tripBadge(trip: TripRecord) {
  if (trip.status === 'completed') return <StatusBadge status="completed" tone="attention" label="To reconcile" />;
  return <StatusBadge status={trip.status} />;
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
  // Orders planned for this trip's day with its driver or vehicle come first.
  const all = orders.data?.items ?? [];
  const tripDay = trip.plannedDate?.slice(0, 10) ?? null;
  const planned = all.filter(
    (o) => tripDay !== null && o.deliveryDate === tripDay && (o.plannedDriverId === trip.driverEmployeeId || o.plannedVehicleId === trip.vehicleId),
  );
  const others = all.filter((o) => !planned.includes(o));
  const option = (o: OrderRecord) => (
    <option key={o.id} value={o.id}>
      {formatOrderNumber(o.number)} · {customerName(o.customerId)}
      {o.deliveryDate ? ` · ${formatDate(o.deliveryDate)}` : ''}
      {o.totalValue ? ` · ${formatMoney(o.totalValue, currency)}` : ''}
    </option>
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
            {planned.length > 0 ? (
              <>
                <optgroup label={t('Planned for this trip')}>{planned.map(option)}</optgroup>
                {others.length > 0 && <optgroup label={t('Other confirmed orders')}>{others.map(option)}</optgroup>}
              </>
            ) : (
              others.map(option)
            )}
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
                {formatPoNumber(po.number)} · {farmerName(po.farmerId)}
                {po.pickupDate ? ` · ${t('Pickup')} ${formatDate(po.pickupDate)}` : ` · raised ${formatDateTime(po.createdAt, timeZone)}`}
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
type Tab = 'overview' | 'stops' | 'quantities' | 'expenses' | 'backhaul';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'stops', label: 'Stops' },
  { value: 'quantities', label: 'Quantities' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'backhaul', label: 'Backhaul' },
];

/** "Ginger 500 kg · +1" for a stop. */
function stopLoad(stop: TripStopRecord): string {
  const items = stop.items ?? [];
  const first = items[0];
  if (!first) return '';
  return `${first.productName} ${formatQuantity(first.quantity, first.uom)}${items.length > 1 ? ` · +${items.length - 1}` : ''}`;
}

const FARM_REASONS: Record<string, string> = {
  quality_issue: 'Quality issue',
  quantity_short: 'Quantity short',
  damaged: 'Damaged',
  farmer_not_ready: 'Farmer not ready',
  other: 'Other',
};

/** A completed farm stop (driver app D2): "Loaded 795 kg · Rejected: Ginger (Quality issue) · Packed by Mani, loaded by Kumar". */
function farmOutcome(farm: NonNullable<TripStopRecord['farm']>, t: (s: string, v?: Record<string, string>) => string): string {
  const parts = [t('Loaded {kg}', { kg: formatQuantity(farm.loadedKg, 'kg') })];
  const rejected = farm.lines.filter((l) => l.outcome === 'rejected');
  if (rejected.length > 0) {
    parts.push(`${t('Rejected')}: ${rejected.map((l) => `${l.productName} (${t(FARM_REASONS[l.reason ?? 'other'])}${l.note ? ` — ${l.note}` : ''})`).join(', ')}`);
  }
  if (farm.packer && farm.loader) {
    parts.push(
      farm.packer.employeeId === farm.loader.employeeId
        ? t('Packed and loaded by {name}', { name: farm.packer.name })
        : t('Packed by {packer}, loaded by {loader}', { packer: farm.packer.name, loader: farm.loader.name }),
    );
  }
  return parts.join(' · ');
}

const SHORT_REASONS: Record<string, string> = {
  customer_took_less: 'The customer took less',
  damaged: 'Damaged',
  not_enough_on_vehicle: 'Not enough on the vehicle',
  quality_issue: 'Quality issue',
  other: 'Other',
};

/** A completed delivery (driver app D3): "QR scanned · Short: Tomato 300 of 350 kg (The customer took less) · Crates 20 left, 18 back". */
function deliveryOutcome(delivery: NonNullable<TripStopRecord['delivery']>, t: (s: string, v?: Record<string, string>) => string): string {
  const parts: string[] = [];
  if (delivery.qrStatus === 'scanned') parts.push(t('QR scanned'));
  else if (delivery.qrStatus === 'not_scanned') parts.push(`${t('QR not scanned')}${delivery.qrNote ? ` — ${delivery.qrNote}` : ''}`);
  if (delivery.shortfalls.length > 0) {
    const lines = delivery.shortfalls.map(
      (s) =>
        `${t('{product} {delivered} of {ordered}', { product: s.productName, delivered: formatQuantity(s.delivered, s.uom), ordered: formatQuantity(s.ordered, s.uom) })} (${t(SHORT_REASONS[s.reason])}${s.note ? ` — ${s.note}` : ''})`,
    );
    parts.push(t('Short: {lines}', { lines: lines.join(', ') }));
  }
  if (delivery.crates.dropped > 0 || delivery.crates.collected > 0) {
    parts.push(t('Crates {left} left, {back} back', { left: String(delivery.crates.dropped), back: String(delivery.crates.collected) }));
  }
  return parts.join(' · ');
}

function stopTitle(stop: TripStopRecord, t: (s: string) => string): string {
  return stop.party?.name ?? (stop.stopType === 'delivery' ? t('Delivery') : t('Pickup'));
}

/**
 * Trip details (client design: Trip Details & Reconciliation): the number,
 * route, day and crew; tabs for the overview (route drawn from map pins,
 * counts, the stops as a timeline), the stops (reorder while planned,
 * navigate), the quantities, and the expenses; and, once submitted, the
 * owner's reconcile and close.
 */
function TripDetail({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const t = useT();
  const { data, error, isPending, refetch } = useTripDetail(tripId);
  const incentives = useTripIncentives(tripId);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();
  const routeName = useRouteName();
  const { data: session } = useSession();
  const canDispatch = hasPermission(session, 'logistics:dispatch');
  const canWrite = hasPermission(session, 'logistics:write');
  const canReconcile = hasPermission(session, 'logistics:reconcile');
  const [open, setOpen] = useState<Open | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const close = () => setOpen(null);
  const transition = useAction(
    (step: 'start' | 'complete' | 'cancel') =>
      apiSend<TripRecord>('POST', `logistics/trips/${tripId}/${step}`, { version: data?.trip.version }),
    TRIP_EFFECTS,
    close,
  );
  const reorder = useAction(
    (stopIds: string[]) => apiSend<TripStopRecord[]>('PUT', `logistics/trips/${tripId}/stops/order`, { version: data?.trip.version, stopIds }),
    TRIP_EFFECTS,
  );
  const stopsForMap = data?.stops ?? [];
  const { depot, points } = useTripPoints(stopsForMap);

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
  const customers = new Set(stops.filter((s) => s.stopType === 'delivery').map((s) => s.party?.id)).size;
  const farmers = new Set(stops.filter((s) => s.stopType === 'pickup').map((s) => s.party?.id)).size;
  const distance = tripDistance(depot, points);
  const navigate = navigateUrl(depot, points);
  const move = (i: number, by: -1 | 1) => {
    const ids = stops.map((s) => s.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    reorder.mutate(ids);
  };
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
    <DetailPanel title={`${trip.number}`} onClose={onClose}>
      <p className="trip-head">
        {trip.routeId ? routeName(trip.routeId) : t('No route')} · {trip.plannedDate ? formatDate(trip.plannedDate) : formatDate(trip.createdAt.slice(0, 10))}
        {trip.startedAt && ` · ${t('Started')} ${timeOf(trip.startedAt, timeZone)}`}
      </p>
      <div className="trip-tabs">
        <FilterTabs label="Trip details" options={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
      </div>

      {tab === 'overview' && (
        <>
          <KeyValues
            items={[
              ['Status', tripBadge(trip)],
              ['Driver', employeeName(trip.driverEmployeeId)],
              ['Vehicle', vehicleName(trip.vehicleId)],
              ['Packer', trip.packerEmployeeId ? employeeName(trip.packerEmployeeId) : '—'],
              ['Loader', trip.loaderEmployeeId ? employeeName(trip.loaderEmployeeId) : '—'],
              ['Planned for', trip.plannedDate ? formatDate(trip.plannedDate) : '—'],
              ['Started', formatDateTime(trip.startedAt, timeZone)],
              ['Finished', formatDateTime(trip.completedAt, timeZone)],
              ['Cash advance', formatMoney(trip.advanceAmount, currency)],
              ...(trip.openingKm || trip.closingKm
                ? ([
                    ['Opening KM', trip.openingKm ? formatQuantity(trip.openingKm, 'km') : '—'],
                    ['Closing KM', trip.closingKm ? formatQuantity(trip.closingKm, 'km') : '—'],
                    ['Trip KM', trip.openingKm && trip.closingKm ? formatQuantity((Number(trip.closingKm) - Number(trip.openingKm)).toFixed(1), 'km') : '—'],
                  ] as [string, string][])
                : []),
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
                title={stops.length === 0 ? t('Add a stop first') : undefined}
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
                title={pending > 0 ? t('{n} stop(s) still pending', { n: pending }) : undefined}
                onClick={() => setOpen('complete')}
              >
                {t('Complete trip')}
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
            {canDispatch && (
              <Link className="button" href={`/chat?driver=${trip.driverEmployeeId}&trip=${trip.id}`}>
                <Icon name="chat" size={16} /> {t('Message the driver')}
              </Link>
            )}
            {canWrite && active && (
              <button type="button" className="button button-danger" onClick={() => setOpen('cancel')}>
                {t('Cancel trip')}
              </button>
            )}
          </ActionBar>

          {incentives.data && <TripIncentivesView data={incentives.data} currency={currency} />}
          <TripMap stops={stops} />
          <div className="count-tiles trip-tiles">
            <span className="count-tile">
              <span className="count-tile-value">{farmers}</span>
              <span className="count-tile-label">{t('Farmers')}</span>
            </span>
            <span className="count-tile">
              <span className="count-tile-value">{customers}</span>
              <span className="count-tile-label">{t('Customers')}</span>
            </span>
            <span className="count-tile">
              <span className="count-tile-value">{stops.length}</span>
              <span className="count-tile-label">{t('Stops')}</span>
            </span>
            <span className="count-tile">
              <span className="count-tile-value">{distance === null ? '—' : `~${Math.round(distance)} km`}</span>
              <span className="count-tile-label">{t('Distance')}</span>
            </span>
          </div>

          <h3 className="detail-subhead">
            {t('Stops ·')} {stops.length - pending} of {stops.length} done
          </h3>
          <ol className="stop-list timeline">
            {stops.length === 0 && <li className="muted">{t('No stops planned yet.')}</li>}
            {stops.map((stop) => (
              <li key={stop.id} data-status={stop.status}>
                <span className="stop-seq">{stop.sequenceNumber}</span>
                <span className="timeline-time">{timeOf(stop.completedAt, timeZone) ?? '—'}</span>
                <span>
                  <strong>{stopTitle(stop, t)}</strong>
                  <span className="muted">
                    {' '}
                    · {stop.stopType === 'delivery' ? t('Delivery') : t('Pickup')}
                    {stopLoad(stop) ? ` · ${stopLoad(stop)}` : ''}
                  </span>
                </span>
                <StatusBadge status={stop.status} />
              </li>
            ))}
          </ol>
          {trip.status === 'in_progress' && pending > 0 && (
            <p className="footnote">{t('The driver completes each stop from the driver app, with proof of delivery and any cash collected.')}</p>
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
        </>
      )}

      {tab === 'stops' && (
        <>
          {navigate && (
            <a className="button navigate-link" href={navigate} target="_blank" rel="noopener noreferrer">
              <Icon name="navigate" size={16} /> {t('Navigate the route')}
            </a>
          )}
          <ol className="stop-list" data-updating={reorder.isPending || undefined}>
            {stops.length === 0 && <li className="muted">{t('No stops planned yet.')}</li>}
            {stops.map((stop, i) => (
              <li key={stop.id} data-status={stop.status}>
                <span className="stop-seq">{stop.sequenceNumber}</span>
                <span className="stop-main">
                  <strong>{stopTitle(stop, t)}</strong>
                  <span className="muted">
                    {stop.stopType === 'delivery'
                      ? `${t('Delivery')}${stop.orderId ? ` · ${t('order')}` : ''}`
                      : `${t('Pickup')}`}
                    {stopLoad(stop) ? ` · ${stopLoad(stop)}` : ''}
                    {stop.party?.phone ? ` · ${stop.party.phone}` : ''}
                  </span>
                  {stop.collect?.terms === 'cash' && (
                    <span className="muted">
                      {t('Collect')} {formatMoney(stop.collect.amount, currency)}
                    </span>
                  )}
                  {stop.notes && <span className="muted">{stop.notes}</span>}
                  {stop.farm && <span className="muted">{farmOutcome(stop.farm, t)}</span>}
                  {stop.delivery && deliveryOutcome(stop.delivery, t) && <span className="muted">{deliveryOutcome(stop.delivery, t)}</span>}
                  {stop.completedAt && <span className="muted">{formatDateTime(stop.completedAt, timeZone)}</span>}
                </span>
                <StatusBadge status={stop.status} />
                {canDispatch && trip.status === 'planned' && stops.length > 1 && (
                  <span className="route-stop-actions">
                    <button type="button" className="icon-button" aria-label={t('Move {name} up', { name: stopTitle(stop, t) })} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="arrowUp" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('Move {name} down', { name: stopTitle(stop, t) })}
                      disabled={i === stops.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <Icon name="arrowDown" size={16} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {reorder.error ? (
            <p className="form-error" role="alert">
              {t('The new order was not saved — reload and try again.')}
            </p>
          ) : null}
          {canDispatch && trip.status === 'planned' && (
            <ActionBar>
              <button type="button" className="button" onClick={() => setOpen('delivery')}>
                {t('Add delivery')}
              </button>
              <button type="button" className="button" onClick={() => setOpen('pickup')}>
                {t('Add pickup')}
              </button>
            </ActionBar>
          )}
        </>
      )}

      {tab === 'quantities' && <TripQuantitiesView tripId={trip.id} />}

      {tab === 'backhaul' && <TripBackhaulView trip={trip} />}

      {tab === 'expenses' && (
        <>
          {expenses.length === 0 ? (
            <p className="muted">{t('None recorded.')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>
                        {t(EXPENSE_LABEL[expense.category])}
                        {expense.paidBy === 'fastag' && <div className="cell-sub">{t('Paid by FASTag')}</div>}
                      </td>
                      <td className="muted">
                        {expense.notes ?? ''}
                        {expenseFacts(expense, currency, t).map((fact) => (
                          <div key={fact} className="cell-sub">
                            {fact}
                          </div>
                        ))}
                      </td>
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
          {canWrite && (trip.status === 'planned' || trip.status === 'in_progress') && (
            <ActionBar>
              <button type="button" className="button" onClick={() => setOpen('expense')}>
                {t('Record expense')}
              </button>
            </ActionBar>
          )}
        </>
      )}

      {open === 'delivery' && <AddDeliveryDialog trip={trip} onClose={close} />}
      {open === 'pickup' && <AddPickupDialog trip={trip} onClose={close} />}
      {open === 'expense' && <ExpenseDialog trip={trip} onClose={close} />}
      {open === 'start' &&
        confirmStep('start', 'Start this trip?', <p>{t('Marks the vehicle as on the road with {n} stop(s).', { n: stops.length })}</p>, 'Start trip')}
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

// ---- The list ----

const STAGE: Record<TripStatus, { label: string; tone: CardTone }> = {
  planned: { label: 'Planned', tone: 'pending' },
  in_progress: { label: 'In Progress', tone: 'progress' },
  completed: { label: 'To close', tone: 'pending' },
  on_hold: { label: 'On hold', tone: 'bad' },
  reconciled: { label: 'Completed', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

const STAGE_FILTER = [
  { value: 'all', label: 'All statuses' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'To close' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'reconciled', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** "4 Customers · 2 Farmers". */
function partiesLine(card: TripCard, t: (s: string, v?: Record<string, string | number>) => string): string {
  return [
    card.customers ? t(card.customers === 1 ? '{n} Customer' : '{n} Customers', { n: card.customers }) : null,
    card.farmers ? t(card.farmers === 1 ? '{n} Farmer' : '{n} Farmers', { n: card.farmers }) : null,
  ]
    .filter(Boolean)
    .join(' · ') || t('No stops yet');
}

/** The Trips list (client design V1.1, screen 7). */
export default function LogisticsPage() {
  const t = useT();
  const [day, setDay] = useState<TripsBoardDay>('today');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useOpenOnNew(() => setCreating(true));
  useOpenParam(setSelected);
  const { data: session } = useSession();
  const canDispatch = hasPermission(session, 'logistics:dispatch');
  const board = useTripsBoard(day, query);
  const cards = (board.data?.items ?? []).filter((c) => stage === 'all' || c.status === stage);
  const counts = board.data?.counts;

  return (
    <div className="list-split">
      <div className="list-screen">
        <h1 className="page-title visually-hidden">{t('Trips')}</h1>
        {creating && (
          <CreateTripDialog
            onClose={() => setCreating(false)}
            onCreated={(trip) => {
              setCreating(false);
              setSelected(trip.id);
            }}
          />
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
          placeholder="Search trip, route…"
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
              <div className="list-empty">{query || stage !== 'all' ? t('Nothing matches.') : t('No trips for this day.')}</div>
            )}
            {cards.map((card) => (
              <ListCard
                key={card.id}
                number={card.number}
                title={card.routeName ?? t('No route')}
                place={partiesLine(card, t)}
                detail={`${formatQuantity(String(Number(card.kg)), 'kg')} · ${t('{done} of {all} stops done', { done: card.stopsDone, all: card.stops })}`}
                time={clock(card.time)}
                status={STAGE[card.status].label}
                tone={STAGE[card.status].tone}
                person={card.driverName}
                vehicle={card.vehicle}
                initial={card.routeName ?? 'T'}
                selected={selected === card.id}
                onOpen={() => setSelected(card.id)}
              />
            ))}
          </div>
        )}
        {canDispatch && <CreateBar label="Create Trip" onClick={() => setCreating(true)} />}
      </div>
      {selected && <TripDetail key={selected} tripId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
