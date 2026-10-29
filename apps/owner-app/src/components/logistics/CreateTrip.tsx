'use client';

import { useEffect, useState } from 'react';
import type { CreateTripBody, PlanOrder, PlanPickup, TripRecord } from '@morbeez/shared-types';
import { Field, FormDialog } from '@/components/ui/Form';
import { KeyValues } from '@/components/ui/DetailPanel';
import { SearchSelect } from '@/components/forms/SearchSelect';
import { QuickAddRoute } from '@/components/forms/QuickAdd';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import {
  useActiveDrivers,
  useActiveEmployees,
  useActiveVehicles,
  useCurrency,
  useEmployeeName,
  useTenantProfile,
  useVehicleName,
} from '@/lib/hooks/use-lookups';
import { useRouteName, useRoutes, formatOrderNumber } from '@/lib/hooks/use-delivery-orders';
import { formatPoNumber } from '@/lib/hooks/use-procurement';
import { useTripPlan } from '@/lib/hooks/use-trips';
import { formatDate, formatMoney, formatQuantity, todayIn } from '@/lib/format';
import { parseOptionalMoney } from '@/lib/parse';
import { useT } from '@/lib/i18n';

const TRIP_EFFECTS = [KEYS.logistics, KEYS.orders, KEYS.procurement, KEYS.inventory, KEYS.finance, KEYS.dashboard];

const kg = (value: number | string) => formatQuantity(String(Number(value)), 'kg');
const sum = (values: string[]) => values.reduce((n, v) => n + Number(v), 0);

/** The value most of them share (the planned driver or vehicle), if any. */
function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/** "Ginger 400 kg · +1". */
function itemsSummary(items: { name: string; quantity: string; uom: string }[]): string {
  const first = items[0];
  if (!first) return '';
  return `${first.name} ${formatQuantity(first.quantity, first.uom)}${items.length > 1 ? ` · +${items.length - 1}` : ''}`;
}

type PlannedStop = { kind: 'pickup' | 'delivery'; key: string; name: string; place: string | null; kg: string; label: string; position: number | null };

/** Stops in the order the trip will have them: the route's order, anyone not on it after, pickups before deliveries. */
function inVisitingOrder(orders: PlanOrder[], pickups: PlanPickup[]): PlannedStop[] {
  const stops = [
    ...pickups.map((p) => ({ kind: 'pickup' as const, key: p.pickupId, name: p.farmerName, place: p.place, kg: p.kg, label: formatPoNumber(p.poNumber), position: p.routePosition, first: 0 })),
    ...orders.map((o) => ({ kind: 'delivery' as const, key: o.id, name: o.customerName, place: o.place, kg: o.kg, label: formatOrderNumber(o.number), position: o.routePosition, first: 1 })),
  ];
  const at = (s: { position: number | null }) => s.position ?? Number.MAX_SAFE_INTEGER;
  return stops.sort((a, b) => at(a) - at(b) || a.first - b.first);
}

/**
 * The quantity check (client design, Create Trip): what goes out to
 * customers, what comes in from farmers, what's on the vehicle already, and
 * whether it all fits. Deliveries leave with stock already reserved for
 * them; pickups come back to be graded.
 */
function QuantityCheck({ deliveryKg, procuredKg, stockKg, capacityKg }: { deliveryKg: number; procuredKg: number; stockKg: number | null; capacityKg: number | null }) {
  const t = useT();
  const onBoard = deliveryKg + procuredKg + (stockKg ?? 0);
  const over = capacityKg !== null && capacityKg > 0 && onBoard > capacityKg;
  return (
    <div className="qty-check form-wide" data-tone={over ? 'bad' : 'ok'} aria-label={t('Quantity check')}>
      <div className="qty-check-figures">
        <span>
          {t('Delivery')}
          <strong>{kg(deliveryKg)}</strong>
        </span>
        <span>
          {t('Procurement')}
          <strong>{kg(procuredKg)}</strong>
        </span>
        <span>
          {t('Vehicle stock')}
          <strong>{stockKg === null ? '—' : kg(stockKg)}</strong>
        </span>
        <span>
          {t('On board, at most')}
          <strong>
            {kg(onBoard)}
            {capacityKg ? ` / ${kg(capacityKg)}` : ''}
          </strong>
        </span>
      </div>
      <p>
        {over
          ? t('More than the vehicle carries — take some stops off or choose a bigger vehicle.')
          : capacityKg
            ? t('Fits the vehicle.')
            : t('Choose the vehicle to check its capacity.')}{' '}
        {t('Deliveries leave with stock already reserved for them; pickups come back to be graded.')}
      </p>
    </div>
  );
}

function PlanRow({
  checked,
  disabled,
  onToggle,
  title,
  detail,
  note,
  weight,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  title: string;
  detail: string;
  note?: string;
  weight: string;
}) {
  return (
    <label className="plan-row" data-disabled={disabled || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="plan-row-main">
        <strong>{title}</strong>
        <span className="muted">{detail}</span>
        {note && <span className="plan-row-note">{note}</span>}
      </span>
      <span className="plan-row-kg">{weight}</span>
    </label>
  );
}

/**
 * "Create Trip" (client design V1.1, screen 8): the day and route; the
 * route's delivery orders for the day, loaded and ticked (unconfirmed ones
 * shown, with why they can't go yet); the route's farmers' pickups; more
 * of either from outside the route; driver, vehicle, packer, loader; the
 * quantity check — then "Review Trip", with the stops in visiting order,
 * and "Create Trip".
 */
export function CreateTripDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (trip: TripRecord) => void }) {
  const t = useT();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const routes = useRoutes();
  const routeName = useRouteName();
  const drivers = useActiveDrivers();
  const vehicles = useActiveVehicles();
  const employees = useActiveEmployees();
  const employeeName = useEmployeeName();
  const vehicleName = useVehicleName();
  const currency = useCurrency();
  const [step, setStep] = useState<'plan' | 'review'>('plan');
  const [form, setForm] = useState({ date: todayIn(timeZone), routeId: '', driverId: '', vehicleId: '', packerId: '', loaderId: '', advance: '' });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [orderIds, setOrderIds] = useState<Set<string>>(new Set());
  const [pickupIds, setPickupIds] = useState<Set<string>>(new Set());
  const [moreOrders, setMoreOrders] = useState(false);
  const [moreFarmers, setMoreFarmers] = useState(false);
  const [addingRoute, setAddingRoute] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const plan = useTripPlan(form.date, form.routeId, form.vehicleId, true);
  const create = useAction((body: CreateTripBody) => apiSend<TripRecord>('POST', 'logistics/trips', body), TRIP_EFFECTS, onCreated);

  // A new day or route loads its orders and pickups, ticked — and the
  // driver and vehicle most of them were planned with, if none is chosen.
  const data = plan.isPlaceholderData ? undefined : plan.data;
  useEffect(() => {
    if (!data) return;
    const key = `${data.date}|${data.routeId ?? ''}`;
    if (key === loadedFor) return;
    setLoadedFor(key);
    setOrderIds(new Set(data.orders.filter((o) => o.status === 'confirmed').map((o) => o.id)));
    setPickupIds(new Set(data.pickups.map((p) => p.pickupId)));
    const planned = [...data.orders, ...data.pickups];
    setForm((f) => ({
      ...f,
      driverId: f.driverId || mostCommon(planned.map((x) => x.plannedDriverId)) || '',
      vehicleId: f.vehicleId || mostCommon(planned.map((x) => x.plannedVehicleId)) || '',
    }));
  }, [data, loadedFor]);

  const shown = plan.data;
  const allOrders = [...(shown?.orders ?? []), ...(shown?.otherOrders ?? [])];
  const allPickups = [...(shown?.pickups ?? []), ...(shown?.otherPickups ?? [])];
  const chosenOrders = allOrders.filter((o) => orderIds.has(o.id));
  const chosenPickups = allPickups.filter((p) => pickupIds.has(p.pickupId));
  const deliveryKg = sum(chosenOrders.map((o) => o.kg));
  const procuredKg = sum(chosenPickups.map((p) => p.kg));
  const vehicle = shown?.vehicle && shown.vehicle.id === form.vehicleId ? shown.vehicle : null;
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const crew = employees.records.filter((e) => e.id !== form.driverId);
  const activeRoutes = (routes.data ?? []).filter((r) => r.status === 'active');
  const stops = inVisitingOrder(chosenOrders, chosenPickups);
  const check = (
    <QuantityCheck
      deliveryKg={deliveryKg}
      procuredKg={procuredKg}
      stockKg={vehicle ? Number(vehicle.stockKg) : null}
      capacityKg={vehicle ? Number(vehicle.capacityKg) : null}
    />
  );

  const submit = () => {
    if (!form.date) return setProblem(t('Choose the trip date.'));
    if (!form.driverId || !form.vehicleId) return setProblem(t('Choose the driver and the vehicle.'));
    const advance = parseOptionalMoney(form.advance, 'the cash advance');
    if (!advance.ok) return setProblem(advance.error);
    setProblem(null);
    if (step === 'plan') return setStep('review');
    create.mutate({
      plannedDate: form.date,
      routeId: form.routeId || undefined,
      driverEmployeeId: form.driverId,
      vehicleId: form.vehicleId,
      packerEmployeeId: form.packerId || undefined,
      loaderEmployeeId: form.loaderId || undefined,
      advanceAmount: advance.value,
      orderIds: chosenOrders.map((o) => o.id),
      pickupIds: chosenPickups.map((p) => p.pickupId),
    });
  };

  const orderRow = (o: PlanOrder) => (
    <PlanRow
      key={o.id}
      checked={orderIds.has(o.id)}
      disabled={o.status !== 'confirmed'}
      onToggle={() => toggle(orderIds, o.id, setOrderIds)}
      title={o.customerName}
      detail={`${formatOrderNumber(o.number)} · ${itemsSummary(o.items)}${o.place ? ` · ${o.place}` : ''}`}
      note={o.status === 'confirmed' ? undefined : o.awaitingApproval ? t('Waiting for approval') : t('Not confirmed yet — confirm it on Delivery Orders')}
      weight={kg(o.kg)}
    />
  );
  const pickupRow = (p: PlanPickup) => (
    <PlanRow
      key={p.pickupId}
      checked={pickupIds.has(p.pickupId)}
      onToggle={() => toggle(pickupIds, p.pickupId, setPickupIds)}
      title={p.farmerName}
      detail={`${formatPoNumber(p.poNumber)} · ${itemsSummary(p.items)}${p.place ? ` · ${p.place}` : ''}`}
      weight={kg(p.kg)}
    />
  );

  return (
    <>
      <FormDialog
        title={step === 'plan' ? t('Create Trip') : t('Review Trip')}
        submitLabel={step === 'plan' ? t('Review Trip →') : t('Create Trip')}
        size="wide"
        pending={create.isPending}
        error={problem ?? create.error}
        onClose={onClose}
        onSubmit={submit}
      >
        {step === 'plan' ? (
          <>
            <Field label={t('Trip Date')}>
              {(props) => <input {...props} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}
            </Field>
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

            <section className="plan-section form-wide" aria-label={t('Delivery Orders')}>
              <div className="plan-section-head">
                <h3>
                  {t('Delivery Orders')} ({chosenOrders.length})
                </h3>
                <strong>{kg(deliveryKg)}</strong>
              </div>
              <p className="muted">{form.routeId ? t('Auto-loaded from the route for this day.') : t('Choose a route to load its orders for this day.')}</p>
              {(shown?.orders ?? []).map(orderRow)}
              {form.routeId && shown && shown.orders.length === 0 && <p className="muted">{t('No orders on this route for this day.')}</p>}
              {moreOrders && (shown?.otherOrders ?? []).map(orderRow)}
              {moreOrders && shown && shown.otherOrders.length === 0 && <p className="muted">{t('No other confirmed orders for this day.')}</p>}
              {!moreOrders && (
                <button type="button" className="link-button" onClick={() => setMoreOrders(true)}>
                  + {t('Add orders')}
                </button>
              )}
            </section>

            <section className="plan-section form-wide" aria-label={t('Select Procurement')}>
              <div className="plan-section-head">
                <h3>
                  {t('Select Procurement')} ({chosenPickups.length})
                </h3>
                <strong>{kg(procuredKg)}</strong>
              </div>
              {(shown?.pickups ?? []).map(pickupRow)}
              {form.routeId && shown && shown.pickups.length === 0 && <p className="muted">{t("No pickups from this route's farmers for this day.")}</p>}
              {moreFarmers && (shown?.otherPickups ?? []).map(pickupRow)}
              {moreFarmers && shown && shown.otherPickups.length === 0 && <p className="muted">{t('No other pickups scheduled for this day.')}</p>}
              {!moreFarmers && (
                <button type="button" className="link-button" onClick={() => setMoreFarmers(true)}>
                  + {t('Add Farmers')}
                </button>
              )}
            </section>

            <p className="form-section-title form-wide">{t('Assign People & Vehicle')}</p>
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
            <Field label={t('Packer (optional)')}>
              {(props) => (
                <select {...props} value={form.packerId} onChange={(e) => set({ packerId: e.target.value })}>
                  <option value="">{t('No packer')}</option>
                  {crew.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('Loader (optional)')}>
              {(props) => (
                <select {...props} value={form.loaderId} onChange={(e) => set({ loaderId: e.target.value })}>
                  <option value="">{t('No loader')}</option>
                  {crew.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={`${t('Cash advance')} (${currency}, ${t('optional')})`} hint={t('Given to the driver for fuel, tolls, labour')}>
              {(props) => <input {...props} inputMode="decimal" value={form.advance} onChange={(e) => set({ advance: e.target.value })} />}
            </Field>
            {check}
          </>
        ) : (
          <>
            <div className="form-wide">
              <KeyValues
                items={[
                  ['Trip Date', formatDate(form.date)],
                  ['Route', form.routeId ? routeName(form.routeId) : '—'],
                  ['Driver', employeeName(form.driverId)],
                  ['Vehicle', vehicleName(form.vehicleId)],
                  ['Packer', form.packerId ? employeeName(form.packerId) : '—'],
                  ['Loader', form.loaderId ? employeeName(form.loaderId) : '—'],
                  ['Cash advance', form.advance.trim() ? formatMoney(String(Number(form.advance)), currency) : formatMoney('0', currency)],
                ]}
              />
            </div>
            <section className="plan-section form-wide" aria-label={t('Stops, in visiting order')}>
              <div className="plan-section-head">
                <h3>
                  {t('Stops, in visiting order')} ({stops.length})
                </h3>
              </div>
              {stops.length === 0 && <p className="muted">{t('No stops yet — you can add deliveries and pickups to the trip after creating it.')}</p>}
              <ol className="stop-list">
                {stops.map((s, i) => (
                  <li key={s.key}>
                    <span className="stop-seq">{i + 1}</span>
                    <span>
                      <strong>{s.name}</strong>
                      <span className="muted">
                        {' '}
                        · {s.kind === 'pickup' ? t('Pickup') : t('Delivery')} {s.label}
                        {s.place ? ` · ${s.place}` : ''}
                      </span>
                    </span>
                    <span>{kg(s.kg)}</span>
                  </li>
                ))}
              </ol>
            </section>
            {check}
            <div className="form-wide">
              <button type="button" className="button" onClick={() => setStep('plan')}>
                ← {t('Back')}
              </button>
            </div>
          </>
        )}
      </FormDialog>
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
