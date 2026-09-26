'use client';

import { useState } from 'react';
import type { TripRecord, TripStatus } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, FilterTabs, PageHeader, Pager, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { useTripDetail, useTrips } from '@/lib/hooks/use-modules';
import { shortRef, useCurrency, useEmployeeName, useTenantProfile, useVehicleName } from '@/lib/hooks/use-lookups';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'in_progress' as const, label: 'On the road' },
  { value: 'planned' as const, label: 'Planned' },
  { value: 'completed' as const, label: 'To reconcile' },
  { value: 'reconciled' as const, label: 'Reconciled' },
  { value: 'cancelled' as const, label: 'Cancelled' },
];

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

function TripDetail({ trip, onClose }: { trip: TripRecord; onClose: () => void }) {
  const { data, error, isPending, refetch } = useTripDetail(trip.id);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();

  return (
    <DetailPanel title={`Trip · ${vehicleName(trip.vehicleId)}`} onClose={onClose}>
      <KeyValues
        items={[
          ['Driver', employeeName(trip.driverEmployeeId)],
          ['Status', tripBadge(trip)],
          ['Started', formatDateTime(trip.startedAt, timeZone)],
          ['Finished', formatDateTime(trip.completedAt, timeZone)],
          ['Cash advance', formatMoney(trip.advanceAmount, currency)],
        ]}
      />
      {isPending ? (
        <SkeletonLines lines={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <h3 className="detail-subhead">
            Stops · {data.stops.filter((s) => s.status !== 'pending').length} of {data.stops.length} done
          </h3>
          <ol className="stop-list">
            {data.stops.length === 0 && <li className="muted">No stops planned yet.</li>}
            {data.stops.map((stop) => (
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

          <h3 className="detail-subhead">Expenses</h3>
          {data.expenses.length === 0 ? (
            <p className="muted">None recorded.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {data.expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="capitalize">{expense.category}</td>
                      <td className="muted">{expense.notes ?? ''}</td>
                      <td className="align-right">{formatMoney(expense.amount, currency)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={2}>Total</td>
                    <td className="align-right">
                      {formatMoney(sumMoney(data.expenses.map((e) => e.amount)), currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h3 className="detail-subhead">Cash reconciliation</h3>
          {data.reconciliation ? (
            <KeyValues
              items={[
                ['Advance', formatMoney(data.reconciliation.advanceAmount, currency)],
                ['Expenses', formatMoney(data.reconciliation.totalExpenses, currency)],
                ['Cash returned', formatMoney(data.reconciliation.cashReturned, currency)],
                [
                  'Variance',
                  Number(data.reconciliation.variance) === 0 ? (
                    <StatusBadge status="balanced" tone="done" label="Balanced" />
                  ) : (
                    <StatusBadge
                      status="short"
                      tone="bad"
                      label={`${formatMoney(data.reconciliation.variance, currency)} ${
                        Number(data.reconciliation.variance) > 0 ? 'short' : 'over'
                      }`}
                    />
                  ),
                ],
                ['Reconciled', formatDateTime(data.reconciliation.reconciledAt, timeZone)],
              ]}
            />
          ) : (
            <p className="muted">
              {trip.status === 'completed'
                ? 'Not reconciled yet — the driver’s advance still needs to be checked against expenses and cash returned.'
                : 'Reconciled once the trip is completed.'}
            </p>
          )}
        </>
      )}
    </DetailPanel>
  );
}

export default function LogisticsPage() {
  const [status, setStatus] = useState<TripStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TripRecord | null>(null);
  const { data, error, isPending, isPlaceholderData, refetch } = useTrips(status === 'all' ? undefined : status, page);
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const vehicleName = useVehicleName();
  const employeeName = useEmployeeName();

  return (
    <div className="stack">
      <PageHeader title="Trips" subtitle="Deliveries and pickups on the road, and the cash each trip carried." />
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
                        selected={selected?.id === trip.id}
                        onSelect={() => setSelected(trip)}
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
        {selected && <TripDetail key={selected.id} trip={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
