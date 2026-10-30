'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { OnTheRoad, VehicleOverview, WorkerRow } from '@morbeez/shared-types';
import { initialsOf, StatTiles } from '@/components/redesign/Party';
import { SearchFilter } from '@/components/redesign/ListCards';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ActionBar } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { FilterTabs } from '@/components/ui/ListControls';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { DOC_LABEL, KIND_LABEL, VehiclePanel } from '@/components/fleet/Vehicles';
import { rateLabel, ROLE_LABEL } from '@/components/workforce/Workers';
import type { DateRange } from '@/lib/hooks/use-accounting';
import { useEconomics, useFleetVehicle } from '@/lib/hooks/use-fleet';
import { useVehicleTrips } from '@/lib/hooks/use-admin';
import { useEmployeeName } from '@/lib/hooks/use-lookups';
import { formatDate, formatMoney, formatQuantity } from '@/lib/format';
import { displayLogin } from '@/lib/phone';
import { useT } from '@/lib/i18n';

/**
 * Workforce & Vehicles (client design, set 1 screens 15 and 22): the two
 * lists as cards — who is active, on a trip or inactive; which vehicle is
 * on a trip, available, in maintenance or not fit — and a vehicle's details.
 */

/** The Workforce / Vehicles switch at the top of both pages. */
export function PeopleTabs({ active }: { active: 'workforce' | 'vehicles' }) {
  const t = useT();
  return (
    <div className="day-tabs" role="group" aria-label={t('Workforce or vehicles')}>
      <Link href="/workforce" aria-pressed={active === 'workforce'} className="day-tab-link">
        {t('Workforce')}
      </Link>
      <Link href="/vehicles" aria-pressed={active === 'vehicles'} className="day-tab-link">
        {t('Vehicles')}
      </Link>
    </div>
  );
}

type WorkerState = { label: string; tone: 'done' | 'progress' | 'muted' };

function workerState(w: WorkerRow, onTrip: Set<string>): WorkerState {
  if (w.status === 'archived') return { label: 'Inactive', tone: 'muted' };
  if (onTrip.has(w.employeeId)) return { label: 'On trip', tone: 'progress' };
  return { label: 'Active', tone: 'done' };
}

export function WorkerCards({
  workers,
  onTheRoad,
  currency,
  selected,
  onSelect,
  onAdd,
}: {
  workers: WorkerRow[];
  onTheRoad: OnTheRoad[];
  /** Shows each one's pay rate; left out for someone who can't see pay. */
  currency?: string;
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd?: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const onTrip = new Set(onTheRoad.flatMap((r) => [r.driverEmployeeId, r.packerEmployeeId, r.loaderEmployeeId].filter((x): x is string => !!x)));
  const q = query.trim().toLowerCase();
  const shown = workers
    .filter((w) => !q || [w.name, ROLE_LABEL[w.roleType] ?? w.roleType, w.phone ?? ''].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.name.localeCompare(b.name));
  return (
    <>
      <div className="search-add">
        <SearchFilter value={query} onChange={setQuery} placeholder="Search name, role…" />
        {onAdd && (
          <button type="button" className="round-add" onClick={onAdd} aria-label={t('Add a worker')}>
            <Icon name="plus" size={20} />
          </button>
        )}
      </div>
      <div className="card-list">
        {shown.length === 0 && <div className="list-empty">{q ? t('Nothing matches.') : t('No workers yet.')}</div>}
        {shown.map((w) => {
          const state = workerState(w, onTrip);
          return (
            <button key={w.employeeId} type="button" className="party-card" aria-current={selected === w.employeeId || undefined} onClick={() => onSelect(w.employeeId)}>
              <span className="party-avatar" aria-hidden="true">
                {initialsOf(w.name)}
              </span>
              <span className="party-main">
                <span className="party-name">{w.name}</span>
                <span className="party-sub">
                  {t(ROLE_LABEL[w.roleType] ?? w.roleType)}
                  {w.phone ? ` · ${displayLogin(w.phone)}` : ''}
                </span>
                {currency && <span className="party-detail">{rateLabel(w.currentRate, currency)}</span>}
              </span>
              <span className="party-side">
                <span className="list-card-status" data-tone={state.tone}>
                  {t(state.label)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

type VehicleState = { label: string; tone: 'done' | 'progress' | 'pending' | 'bad' | 'muted' };

function vehicleState(v: VehicleOverview, trip: OnTheRoad | undefined): VehicleState {
  if (v.status === 'disposed') return { label: 'Disposed', tone: 'muted' };
  if (trip) return { label: 'On trip', tone: 'progress' };
  if (v.status === 'maintenance') return { label: 'In maintenance', tone: 'pending' };
  if (!v.fitForTrips) return { label: 'Not fit', tone: 'bad' };
  return { label: 'Available', tone: 'done' };
}

export function VehicleCards({
  vehicles,
  onTheRoad,
  selected,
  onSelect,
  onAdd,
}: {
  vehicles: VehicleOverview[];
  onTheRoad: OnTheRoad[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd?: () => void;
}) {
  const t = useT();
  const employeeName = useEmployeeName();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = vehicles.filter((v) => !q || [v.registrationNumber, v.makeModel ?? ''].some((s) => s.toLowerCase().includes(q)));
  return (
    <>
      <div className="search-add">
        <SearchFilter value={query} onChange={setQuery} placeholder="Search vehicle…" />
        {onAdd && (
          <button type="button" className="round-add" onClick={onAdd} aria-label={t('Add a vehicle')}>
            <Icon name="plus" size={20} />
          </button>
        )}
      </div>
      <div className="card-list">
        {shown.length === 0 && <div className="list-empty">{q ? t('Nothing matches.') : t('No vehicles yet.')}</div>}
        {shown.map((v) => {
          const trip = onTheRoad.find((r) => r.vehicleId === v.vehicleId);
          const state = vehicleState(v, trip);
          return (
            <button key={v.vehicleId} type="button" className="party-card" aria-current={selected === v.vehicleId || undefined} onClick={() => onSelect(v.vehicleId)}>
              <span className="party-avatar vehicle-avatar" aria-hidden="true">
                <Icon name="truck" size={20} />
              </span>
              <span className="party-main">
                <span className="party-name">
                  {v.registrationNumber}
                  {v.makeModel ? ` (${v.makeModel})` : ''}
                </span>
                <span className="party-sub">
                  {trip ? `${employeeName(trip.driverEmployeeId)} · ${trip.number}` : t(v.ownership === 'hired' ? 'Hired' : 'Owned')}
                </span>
                {v.issues[0] && <span className="party-detail">{v.issues[0]}</span>}
              </span>
              <span className="party-side">
                <span className="list-card-status" data-tone={state.tone}>
                  {t(state.label)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

type Tab = 'overview' | 'trips' | 'maintenance' | 'costs';

const TRIP_STATUS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In Progress',
  completed: 'To close',
  on_hold: 'On hold',
  reconciled: 'Completed',
};

/**
 * Vehicle details (set 1 screen 22): Overview (trips, KM, fuel, who drives
 * it, documents due), its trips, maintenance and documents, and what it
 * cost. "Edit & record" (or "All details", for someone who can't write)
 * opens the full fleet record — fuel, maintenance and documents to record,
 * the books, loans and hire.
 */
export function VehicleDetails({
  id,
  currency,
  today,
  canWrite,
  canFinance,
  canSeeTrips,
  onTheRoad,
  initialFull = false,
  onClose,
}: {
  id: string;
  currency: string;
  today: string;
  canWrite: boolean;
  canFinance: boolean;
  canSeeTrips: boolean;
  onTheRoad: OnTheRoad[];
  /** Straight to the full record — a vehicle just added, with its fuel and documents to record. */
  initialFull?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('overview');
  const [full, setFull] = useState(initialFull);
  const [range, setRange] = useState<DateRange>(() => presetRange('month', today));
  const vehicle = useFleetVehicle(id);
  const trips = useVehicleTrips(id, canSeeTrips);
  // Fuel economy over the last quarter; the Costs tab's own dates for the rest.
  const quarter = useEconomics({ from: addDays(today, -90), to: today });
  const costs = useEconomics(tab === 'costs' ? range : null);

  if (full) {
    return <VehiclePanel id={id} currency={currency} today={today} canWrite={canWrite} canFinance={canFinance} onClose={() => setFull(false)} />;
  }
  if (vehicle.isPending || vehicle.error || !vehicle.data) {
    return (
      <DetailPanel title={t('Vehicle')} onClose={onClose}>
        {vehicle.error ? <ErrorState error={vehicle.error} onRetry={() => vehicle.refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  const v = vehicle.data;
  const onTrip = onTheRoad.find((r) => r.vehicleId === id);
  const state = vehicleState(v, onTrip);
  const economy = quarter.data?.rows.find((r) => r.vehicleId === id);
  const insurance = v.documents.find((d) => d.docType === 'insurance');
  const due = v.maintenanceDue;
  const crew = trips.data?.crew;
  const cost = costs.data?.rows.find((r) => r.vehicleId === id);

  return (
    <DetailPanel title={v.registrationNumber} onClose={onClose}>
      <div className="profile-head">
        <span className="party-avatar party-avatar-large vehicle-avatar" aria-hidden="true">
          <Icon name="truck" size={26} />
        </span>
        <span className="party-main">
          <span className="profile-name">
            {v.registrationNumber}
            {v.makeModel ? ` (${v.makeModel})` : ''}
          </span>
          <span className="party-sub">{[crew?.driverName, t(state.label)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="list-card-status" data-tone={state.tone}>
          {t(v.status === 'disposed' ? 'Disposed' : 'Active')}
        </span>
      </div>
      <div className="trip-tabs">
        <FilterTabs
          label="Vehicle details"
          options={[
            { value: 'overview', label: 'Overview' },
            ...(canSeeTrips ? [{ value: 'trips', label: 'Trips' }] : []),
            { value: 'maintenance', label: 'Maintenance' },
            { value: 'costs', label: 'Costs' },
          ]}
          value={tab}
          onChange={(x) => setTab(x as Tab)}
        />
      </div>

      {tab === 'overview' && (
        <>
          <StatTiles
            items={[
              { label: 'Total trips', value: trips.data ? String(trips.data.trips) : '—' },
              { label: 'Total KM', value: trips.data ? formatQuantity(trips.data.km) : '—' },
              { label: 'Avg. fuel (km/l)', value: economy?.kmPerLitre ?? '—' },
            ]}
          />
          <KeyValues
            items={[
              ['Vehicle type', v.makeModel ?? '—'],
              ['Registration No.', v.registrationNumber],
              ['Driver', crew ? `${crew.driverName}${crew.driverPhone ? ` (${displayLogin(crew.driverPhone)})` : ''}` : '—'],
              ['Helper / Packer', crew?.packerName ?? '—'],
              ['Ownership', t(v.ownership === 'hired' ? 'Hired' : 'Owned')],
              ['Capacity', formatQuantity(v.capacityKg, 'kg')],
              ['Next service due', due ? [due.date ? formatDate(due.date) : null, due.km ? `${due.km.toLocaleString('en-IN')} km` : null].filter(Boolean).join(' or ') + (due.overdue ? ` — ${t('overdue')}` : '') : '—'],
              ['Insurance valid till', insurance?.validUntil ? formatDate(insurance.validUntil) : '—'],
              ['Fit for trips', v.fitForTrips ? t('Yes') : v.issues.join('; ') || t('No')],
            ]}
          />
          <ActionBar>
            <button type="button" className="button" onClick={() => setFull(true)}>
              {t(canWrite ? 'Edit & record' : 'All details')}
            </button>
            {canSeeTrips && (
              <button type="button" className="button button-primary" onClick={() => setTab('trips')}>
                {t('View trips')}
              </button>
            )}
          </ActionBar>
        </>
      )}

      {tab === 'trips' &&
        (trips.isPending ? (
          <SkeletonLines lines={5} />
        ) : !trips.data || trips.data.recent.length === 0 ? (
          <p className="muted">{t('No trips yet.')}</p>
        ) : (
          <ol className="stop-list no-seq">
            {trips.data.recent.map((r) => (
              <li key={r.id} data-status={r.status === 'reconciled' ? 'completed' : r.status === 'in_progress' ? 'pending' : undefined}>
                <span className="stop-main">
                  <Link href={`/logistics?open=${r.id}`}>
                    <strong>{r.number}</strong>
                  </Link>
                  <span className="muted">
                    {formatDate(r.day)} · {r.routeName ?? t('No route')} · {r.driverName}
                    {r.km ? ` · ${formatQuantity(r.km, 'km')}` : ''}
                  </span>
                </span>
                <span className="list-card-status">{t(TRIP_STATUS[r.status] ?? r.status)}</span>
              </li>
            ))}
          </ol>
        ))}

      {tab === 'maintenance' && (
        <>
          <h3 className="detail-subhead">{t('Maintenance')}</h3>
          {v.maintenance.length === 0 ? (
            <p className="muted">{t('No maintenance recorded.')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {v.maintenance.slice(0, 20).map((m) => (
                    <tr key={m.id}>
                      <td>{formatDate(m.serviceDate)}</td>
                      <td>
                        {t(KIND_LABEL[m.kind])}: {m.description}
                        {m.vendor && <div className="cell-sub">{m.vendor}</div>}
                      </td>
                      <td className="num">{Number(m.amount) ? formatMoney(m.amount, currency) : t('No charge')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="detail-subhead">{t('Documents')}</h3>
          <KeyValues
            items={v.documents.map((d) => [DOC_LABEL[d.docType], d.validUntil ? `${formatDate(d.validUntil)}${d.state === 'expired' ? ` — ${t('expired')}` : d.state === 'expiring' ? ` — ${t('expiring')}` : ''}` : t('No expiry')] as [string, string])}
          />
          {canWrite && (
            <ActionBar>
              <button type="button" className="button" onClick={() => setFull(true)}>
                {t('Record maintenance or a document')}
              </button>
            </ActionBar>
          )}
        </>
      )}

      {tab === 'costs' && (
        <>
          <RangeControls range={range} today={today} onChange={setRange} />
          {costs.isPending ? (
            <SkeletonLines lines={5} />
          ) : !cost ? (
            <p className="muted">{t('No costs in these dates.')}</p>
          ) : (
            <KeyValues
              items={[
                ['Trips', String(cost.trips)],
                ['KM', cost.km === null ? '—' : cost.km.toLocaleString('en-IN')],
                ['Fuel', formatMoney(cost.fuel, currency)],
                ['Maintenance', formatMoney(cost.maintenance, currency)],
                ['Documents', formatMoney(cost.documents, currency)],
                ['Depreciation', formatMoney(cost.depreciation, currency)],
                ['Loan interest', formatMoney(cost.loanInterest, currency)],
                ['Hire', formatMoney(cost.hire, currency)],
                ['Total cost', formatMoney(cost.total, currency)],
                ['Cost per KM', cost.costPerKm ? formatMoney(cost.costPerKm, currency) : '—'],
              ]}
            />
          )}
        </>
      )}
    </DetailPanel>
  );
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
