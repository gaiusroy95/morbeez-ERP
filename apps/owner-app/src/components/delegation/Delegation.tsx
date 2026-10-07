'use client';

import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type {
  DayOffState,
  DelegationListItem,
  DriverPoolEntry,
  EmployeeRecord,
  GrantDelegationBody,
  StartDayOffBody,
  TripRecord,
  TripStopRecord,
} from '@morbeez/shared-types';
import { apiGet, apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { LEVELS, levelName } from '@/lib/hooks/use-delegation';
import { Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';

const REFRESH = [KEYS.delegation, KEYS.logistics];

const timeOf = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' });

const sourceLabel: Record<string, string> = { standing: 'standing', trip: 'this trip', day_off: 'day off', temporary: 'for a while' };

// ---- Day-off mode ----

export function DayOffCard({
  state,
  pool,
  timeZone,
  canDecide,
  onStart,
}: {
  state: DayOffState;
  pool: DriverPoolEntry[];
  timeZone: string;
  canDecide: boolean;
  onStart: () => void;
}) {
  const t = useT();
  const end = useAction(() => apiSend<DayOffState>('POST', 'delegation/day-off/end'), REFRESH);
  const eligible = pool.filter((d) => d.delegationLevel !== null && !d.isMe);
  if (state.away && state.until) {
    const g = state.grants[0];
    return (
      <div className="dayoff" data-away="true">
        <div className="dayoff-text">
          <span className="dayoff-eyebrow">{t('Day-off mode is on')}</span>
          <strong className="dayoff-title">{t("You're away until")} {timeOf(state.until, timeZone)}.</strong>
          <span>
            {g ? `${g.driverName} runs the day as ${levelName(g.level)} (level ${g.level}).` : 'Your backup driver runs the day.'} Only
            exceptions alert you; everything else waits for the evening summary.
          </span>
        </div>
        {canDecide && (
          <button type="button" className="button" onClick={() => end.mutate(undefined)} disabled={end.isPending}>
            {end.isPending ? 'Ending…' : "I'm back"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="dayoff">
      <div className="dayoff-text">
        <span className="dayoff-eyebrow">{t('Taking a day off?')}</span>
        <strong className="dayoff-title">{t('Hand today to a backup driver in two minutes.')}</strong>
        <span>
          {t(
            'They get the vehicle, the route, the pickups, the deliveries and what to collect. You keep the money, the stock and the decisions — and hear about exceptions only. It ends at {time} on its own.',
            { time: state.operatingDayEnd },
          )}
        </span>
      </div>
      {canDecide && (
        <button type="button" className="button button-primary" onClick={onStart} disabled={eligible.length === 0} title={eligible.length === 0 ? 'Make a driver eligible first' : undefined}>
          {t("I'm unavailable today")}
        </button>
      )}
    </div>
  );
}

export function DayOffDialog({
  pool,
  plannedTrips,
  vehicleName,
  employeeName,
  currency,
  onClose,
}: {
  pool: DriverPoolEntry[];
  plannedTrips: TripRecord[];
  vehicleName: (id: string) => string;
  employeeName: (id: string) => string;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const eligible = pool.filter((d) => d.delegationLevel !== null && !d.isMe);
  const [driverId, setDriverId] = useState(eligible[0]?.employeeId ?? '');
  const driver = eligible.find((d) => d.employeeId === driverId);
  const [level, setLevel] = useState<number>(driver?.delegationLevel ?? 1);
  const [tripIds, setTripIds] = useState<string[]>(plannedTrips.map((t) => t.id));
  const [note, setNote] = useState('');
  const start = useAction((body: StartDayOffBody) => apiSend<DayOffState>('POST', 'delegation/day-off', body), REFRESH, onClose);
  const toggle = (id: string) => setTripIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <FormDialog
      title={t('Hand today to a backup driver')}
      description={t("The trips you tick go to this driver. Their authority lasts until the business day ends, or until you say you're back.")}
      submitLabel={t('Start day-off mode')}
      size="wide"
      pending={start.isPending}
      error={start.error}
      onClose={onClose}
      onSubmit={() => start.mutate({ driverEmployeeId: driverId, level, tripIds, note: note.trim() || undefined })}
    >
      <Field label={t('Who runs the day')}>
        {(p) => (
          <select
            {...p}
           
            value={driverId}
            onChange={(e) => {
              setDriverId(e.target.value);
              const next = eligible.find((d) => d.employeeId === e.target.value);
              setLevel(next?.delegationLevel ?? 1);
            }}
          >
            {eligible.map((d) => (
              <option key={d.employeeId} value={d.employeeId}>
                {d.name}
                {d.busy ? ' (on the road)' : ''} — up to level {d.delegationLevel}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('With authority')} hint={LEVELS[level - 1]?.covers}>
        {(p) => (
          <select {...p} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {LEVELS.filter((l) => l.level <= (driver?.delegationLevel ?? 0)).map((l) => (
              <option key={l.level} value={l.level}>
                {t('Level')} {l.level} — {l.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('Note for the record (optional)')} wide>
        {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Family function')} />}
      </Field>
      <div className="field" data-wide="true">
        <span className="field-label">{t("Today's trips")}</span>
        {plannedTrips.length === 0 ? (
          <p className="muted">{t('No planned trips. The driver still gets day-off authority for anything you assign later today.')}</p>
        ) : (
          <div className="handover-trips">
            {plannedTrips.map((t) => (
              <label key={t.id} className="check-row">
                <input type="checkbox" checked={tripIds.includes(t.id)} onChange={() => toggle(t.id)} />
                <span>
                  {vehicleName(t.vehicleId)} · now with {employeeName(t.driverEmployeeId)}
                  {t.advanceAmount !== '0.00' && ` · advance ${formatMoney(t.advanceAmount, currency)}`}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      {tripIds.length > 0 && <HandoverSheet tripIds={tripIds} currency={currency} />}
    </FormDialog>
  );
}

/** The "2-minute handover" (requirement, Owner's Day-Off Mode): what's to pick up, deliver and collect. */
function HandoverSheet({ tripIds, currency }: { tripIds: string[]; currency: string }) {
  const t = useT();
  const stops = useQueries({
    queries: tripIds.map((id) => ({
      queryKey: ['logistics', 'trip', id, 'stops'],
      queryFn: () => apiGet<TripStopRecord[]>(`logistics/trips/${id}/stops`),
    })),
  });
  const all = stops.flatMap((q) => q.data ?? []);
  const pickups = all.filter((s) => s.stopType === 'pickup');
  const deliveries = all.filter((s) => s.stopType === 'delivery');
  const items = (s: TripStopRecord) => (s.items ?? []).map((i) => `${formatQuantity(i.quantity, i.uom)} ${i.productName}`).join(', ') || '—';
  return (
    <div className="handover-sheet" data-wide="true">
      <span className="field-label">{t('What the driver gets')}</span>
      <table className="table table-compact">
        <thead>
          <tr>
            <th>{t('Procurement')}</th>
            <th>{t('Expected')}</th>
          </tr>
        </thead>
        <tbody>
          {pickups.length === 0 && (
            <tr>
              <td colSpan={2} className="muted">
                {t('No pickups.')}
              </td>
            </tr>
          )}
          {pickups.map((s) => (
            <tr key={s.id}>
              <td>{s.party?.name ?? 'Farmer'}</td>
              <td>{items(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="table table-compact">
        <thead>
          <tr>
            <th>{t('Deliveries')}</th>
            <th>{t('Goods')}</th>
            <th className="num">{t('Collect')}</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                {t('No deliveries.')}
              </td>
            </tr>
          )}
          {deliveries.map((s) => (
            <tr key={s.id}>
              <td>{s.party?.name ?? 'Customer'}</td>
              <td>{items(s)}</td>
              <td className="num">{s.collect?.terms === 'cash' ? formatMoney(s.collect.amount, currency) : 'Credit'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- The driver pool ----

export function DriverPoolTable({ pool, canDecide }: { pool: DriverPoolEntry[]; canDecide: boolean }) {
  const t = useT();
  const set = useAction(
    ({ id, ...body }: { id: string; delegationLevel: number | null; standingDelegation: boolean }) =>
      apiSend<EmployeeRecord>('PATCH', `delegation/drivers/${id}`, body),
    REFRESH,
  );
  return (
    <div className="table-wrap">
      {set.error ? <p className="form-error">{(set.error as Error).message}</p> : null}
      <table className="table">
        <thead>
          <tr>
            <th>{t('Driver')}</th>
            <th>{t('Eligible up to')}</th>
            <th>{t('Standing permission')}</th>
            <th>{t('Authority now')}</th>
            <th>{t('Last 90 days')}</th>
          </tr>
        </thead>
        <tbody>
          {pool.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                {t('No drivers yet — add them under Workforce.')}
              </td>
            </tr>
          )}
          {pool.map((d) => (
            <tr key={d.employeeId}>
              <td>
                {d.name} {d.isMe && <StatusBadge status="you" tone="active" label={t('You')} />}
                <div className="cell-sub">
                  {d.busy ? t('On the road') : t('Available')}
                  {!d.hasLogin && ` · ${t('no Driver app login')}`}
                </div>
              </td>
              <td>
                <select
                  className="input-compact"
                  aria-label={`${d.name}: eligible up to`}
                  value={d.delegationLevel ?? ''}
                  disabled={!canDecide || set.isPending}
                  onChange={(e) =>
                    set.mutate({
                      id: d.employeeId,
                      delegationLevel: e.target.value === '' ? null : Number(e.target.value),
                      standingDelegation: d.standingDelegation,
                    })
                  }
                >
                  <option value="">{t('Not eligible')}</option>
                  {LEVELS.map((l) => (
                    <option key={l.level} value={l.level}>
                      {l.level} — {t(l.name)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={d.standingDelegation}
                    disabled={!canDecide || set.isPending || d.delegationLevel === null}
                    onChange={(e) => set.mutate({ id: d.employeeId, delegationLevel: d.delegationLevel, standingDelegation: e.target.checked })}
                  />
                  <span>{d.standingDelegation ? t('Every trip') : t('Approve each trip')}</span>
                </label>
              </td>
              <td>
                {d.authority.level === 0 ? (
                  <span className="muted">{t('None')}</span>
                ) : (
                  <>
                    {t('Level {n}', { n: d.authority.level })}
                    <div className="cell-sub">{t(sourceLabel[d.authority.source ?? ''] ?? '')}</div>
                  </>
                )}
              </td>
              <td>
                {d.tripsClosed === 0 ? (
                  <span className="muted">{t('No closed trips')}</span>
                ) : (
                  <>
                    {t('{n} trip(s) · {pct}% clean', {
                      n: d.tripsClosed,
                      pct: Math.round((d.closedClean / d.tripsClosed) * 100),
                    })}
                    <div className="cell-sub">
                      {d.cashMismatches === 0 ? t('No cash mismatch') : t('{n} cash mismatch(es)', { n: d.cashMismatches })}
                    </div>
                  </>
                )}
                {d.suggestedIndependent && (d.delegationLevel ?? 0) < 4 && (
                  <div>
                    <StatusBadge status="ready" tone="done" label={t('Ready to run routes alone')} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Grants ----

function grantState(g: DelegationListItem): { label: string; tone: 'active' | 'muted' | 'bad' } {
  if (g.revokedAt) return { label: 'Revoked', tone: 'bad' };
  if (g.kind === 'trip') return g.tripStatus === 'planned' || g.tripStatus === 'in_progress' ? { label: 'Active', tone: 'active' } : { label: 'Ended with the trip', tone: 'muted' };
  return g.endsAt && new Date(g.endsAt) > new Date() ? { label: 'Active', tone: 'active' } : { label: 'Ended', tone: 'muted' };
}

export function GrantsTable({ grants, timeZone, canDecide }: { grants: DelegationListItem[]; timeZone: string; canDecide: boolean }) {
  const t = useT();
  const revoke = useAction((id: string) => apiSend('POST', `delegation/grants/${id}/revoke`), REFRESH);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('Driver')}</th>
            <th>{t('Authority')}</th>
            <th>{t('For')}</th>
            <th>{t('Granted')}</th>
            <th>{t('Status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {grants.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-cell">
                {t('Nothing delegated yet.')}
              </td>
            </tr>
          )}
          {grants.map((g) => {
            const st = grantState(g);
            return (
              <tr key={g.id}>
                <td>{g.driverName}</td>
                <td>
                  {t('Level')} {g.level}
                  <div className="cell-sub">{levelName(g.level)}</div>
                </td>
                <td>
                  {g.kind === 'trip' ? 'One trip, until its handover' : g.kind === 'day_off' ? `Your day off, until ${g.endsAt ? timeOf(g.endsAt, timeZone) : '—'}` : `Until ${formatDateTime(g.endsAt, timeZone)}`}
                  {g.note && <div className="cell-sub">{g.note}</div>}
                </td>
                <td>{formatDateTime(g.grantedAt, timeZone)}</td>
                <td>
                  <StatusBadge status={st.label} tone={st.tone} label={st.label} />
                </td>
                <td className="num">
                  {canDecide && st.label === 'Active' && (
                    <button type="button" className="button button-ghost" onClick={() => revoke.mutate(g.id)} disabled={revoke.isPending}>
                      {t('Revoke')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GrantDialog({
  pool,
  trips,
  vehicleName,
  employeeName,
  onClose,
}: {
  pool: DriverPoolEntry[];
  trips: TripRecord[];
  vehicleName: (id: string) => string;
  employeeName: (id: string) => string;
  onClose: () => void;
}) {
  const t = useT();
  const eligible = pool.filter((d) => d.delegationLevel !== null);
  const [driverId, setDriverId] = useState(eligible[0]?.employeeId ?? '');
  const driver = eligible.find((d) => d.employeeId === driverId);
  const [level, setLevel] = useState<number>(driver?.delegationLevel ?? 1);
  const [kind, setKind] = useState<'trip' | 'temporary'>('trip');
  const [tripId, setTripId] = useState(trips[0]?.id ?? '');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const grant = useAction((body: GrantDelegationBody) => apiSend('POST', 'delegation/grants', body), REFRESH, onClose);
  return (
    <FormDialog
      title={t('Delegate')}
      description={t('Authorize a driver for one trip, or for a while. A planned trip given to another driver is handed to them; you stay its owner.')}
      submitLabel={t('Delegate')}
      pending={grant.isPending}
      error={grant.error}
      onClose={onClose}
      onSubmit={() =>
        grant.mutate({
          driverEmployeeId: driverId,
          level,
          kind,
          tripId: kind === 'trip' ? tripId : undefined,
          endsAt: kind === 'temporary' && endsAt ? new Date(endsAt).toISOString() : undefined,
          note: note.trim() || undefined,
        })
      }
    >
      <Field label={t('Driver')}>
        {(p) => (
          <select
            {...p}
           
            value={driverId}
            onChange={(e) => {
              setDriverId(e.target.value);
              setLevel(eligible.find((d) => d.employeeId === e.target.value)?.delegationLevel ?? 1);
            }}
          >
            {eligible.map((d) => (
              <option key={d.employeeId} value={d.employeeId}>
                {d.name} — up to level {d.delegationLevel}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('Level')} hint={LEVELS[level - 1]?.covers}>
        {(p) => (
          <select {...p} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {LEVELS.filter((l) => l.level <= (driver?.delegationLevel ?? 0)).map((l) => (
              <option key={l.level} value={l.level}>
                {t('Level')} {l.level} — {l.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('For')}>
        {(p) => (
          <select {...p} value={kind} onChange={(e) => setKind(e.target.value as 'trip' | 'temporary')}>
            <option value="trip">{t('One trip — ends with its handover')}</option>
            <option value="temporary">{t('A while — ends at a time you set')}</option>
          </select>
        )}
      </Field>
      {kind === 'trip' ? (
        <Field label={t('Trip')}>
          {(p) => (
            <select {...p} value={tripId} onChange={(e) => setTripId(e.target.value)}>
              {trips.length === 0 && <option value="">{t('No planned or running trips')}</option>}
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {vehicleName(t.vehicleId)} · {employeeName(t.driverEmployeeId)} · {t.status === 'planned' ? 'planned' : 'on the road'}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <Field label={t('Ends')}>
          {(p) => <input {...p} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
        </Field>
      )}
      <Field label={t('Note (optional)')} wide>
        {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

export function DriveMyselfDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const add = useAction((body: { name: string }) => apiSend<EmployeeRecord>('POST', 'workforce/me/driver', body), REFRESH, onClose);
  return (
    <FormDialog
      title={t('I drive too')}
      description={t('Trips can then be assigned to you, and the Driver app shows your route when you sign in there with this login. You close your own trips here, as the owner.')}
      submitLabel={t('Add me as a driver')}
      pending={add.isPending}
      error={add.error}
      onClose={onClose}
      onSubmit={() => add.mutate({ name: name.trim() })}
    >
      <Field label={t('Your name on trips')} wide>
        {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Rajesh (owner)')} />}
      </Field>
    </FormDialog>
  );
}

// ---- Day end and alert thresholds ----

export interface AlertSettings {
  operatingDayEnd: string;
  alertCashThreshold: string;
  alertCollectionThreshold: string;
  defaultShrinkageTolerancePct: string;
  defaultBreakageTolerancePct: string;
  weighmentPhoto: 'optional' | 'required' | 'not_required';
}

export function AlertSettingsForm({ settings, currency, canEdit }: { settings: AlertSettings; currency: string; canEdit: boolean }) {
  const t = useT();
  const [dayEnd, setDayEnd] = useState(settings.operatingDayEnd);
  const [cash, setCash] = useState(String(Number(settings.alertCashThreshold)));
  const [collection, setCollection] = useState(String(Number(settings.alertCollectionThreshold)));
  const [shrinkage, setShrinkage] = useState(String(Number(settings.defaultShrinkageTolerancePct)));
  const [breakage, setBreakage] = useState(String(Number(settings.defaultBreakageTolerancePct)));
  const [photo, setPhoto] = useState(settings.weighmentPhoto);
  const save = useAction((body: Record<string, unknown>) => apiSend('PATCH', 'tenants/me', body), [['tenant'], KEYS.delegation, ['products']]);
  return (
    <form
      className="form-grid settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          operatingDayEnd: dayEnd,
          alertCashThreshold: Number(cash),
          alertCollectionThreshold: Number(collection),
          defaultShrinkageTolerancePct: Number(shrinkage),
          defaultBreakageTolerancePct: Number(breakage),
          weighmentPhoto: photo,
        });
      }}
    >
      <Field label={t('Business day ends at')} hint={t('Day-off authority ends here.')}>
        {(p) => <input {...p} type="time" value={dayEnd} disabled={!canEdit} onChange={(e) => setDayEnd(e.target.value)} />}
      </Field>
      <Field label={`Alert when cash handed over is off by (${currency})`} hint={t('At least this much short or over.')}>
        {(p) => <input {...p} inputMode="decimal" value={cash} disabled={!canEdit} onChange={(e) => setCash(e.target.value)} />}
      </Field>
      <Field label={`Alert when cash customers are short by (${currency})`} hint={t('Added up across the trip.')}>
        {(p) => <input {...p} inputMode="decimal" value={collection} disabled={!canEdit} onChange={(e) => setCollection(e.target.value)} />}
      </Field>
      <Field label={t('Live-bird shrinkage accepted (%)')} hint={t("Farm weight vs the customer's scale; products may set their own.")}>
        {(p) => <input {...p} inputMode="decimal" value={shrinkage} disabled={!canEdit} onChange={(e) => setShrinkage(e.target.value)} />}
      </Field>
      <Field label={t('Egg breakage accepted (%)')} hint={t('At purchase and on delivery; products may set their own.')}>
        {(p) => <input {...p} inputMode="decimal" value={breakage} disabled={!canEdit} onChange={(e) => setBreakage(e.target.value)} />}
      </Field>
      <Field label={t("Photo of the customer's scale")} hint={t('When a driver enters a customer-end weight.')}>
        {(p) => (
          <select {...p} value={photo} disabled={!canEdit} onChange={(e) => setPhoto(e.target.value as AlertSettings['weighmentPhoto'])}>
            <option value="optional">{t('Optional')}</option>
            <option value="required">{t('Required')}</option>
            <option value="not_required">{t('Not asked for')}</option>
          </select>
        )}
      </Field>
      {canEdit && (
        <div className="settings-actions" data-wide="true">
          {save.error ? <p className="form-error">{(save.error as Error).message}</p> : null}
          {save.isSuccess && !save.isPending && <span className="muted">{t('Saved.')}</span>}
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </form>
  );
}
