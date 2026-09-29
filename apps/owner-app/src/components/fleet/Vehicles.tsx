'use client';

import { useState } from 'react';
import type {
  HireBasis,
  MaintenanceKind,
  VehicleDetail,
  VehicleDocState,
  VehicleDocType,
  VehicleLoan,
  VehicleOverview,
} from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel, KeyValues } from '@/components/ui/DetailPanel';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { useFleetVehicle, useHireSuggestion } from '@/lib/hooks/use-fleet';
import { formatDate, formatMoney, formatQuantity } from '@/lib/format';
import { firstError, optionalText, parseDecimal, parseMoney, parseOptionalMoney, parseQuantity, parseWholeNumber } from '@/lib/parse';

// What a fleet write moves: the fleet views, the vehicle pick-lists (a
// disposal takes one off the road), and the money views it posted to.
export const FLEET_WRITES = [KEYS.fleet, KEYS.lookupVehicles, KEYS.finance, KEYS.dashboard];

export const DOC_LABEL: Record<VehicleDocType, string> = {
  registration: 'Registration (RC)',
  insurance: 'Insurance',
  puc: 'PUC certificate',
  fitness: 'Fitness certificate',
  permit: 'Permit',
  road_tax: 'Road tax',
  other: 'Other',
};
const DOC_TONE: Record<VehicleDocState, 'done' | 'attention' | 'bad' | 'muted'> = { valid: 'done', expiring: 'attention', expired: 'bad', no_expiry: 'muted' };
const DOC_STATE_LABEL: Record<VehicleDocState, string> = { valid: 'Valid', expiring: 'Expiring', expired: 'Expired', no_expiry: 'No expiry' };
export const KIND_LABEL: Record<MaintenanceKind, string> = { service: 'Service', repair: 'Repair', tyres: 'Tyres', battery: 'Battery', accident: 'Accident', other: 'Other' };
export const BASIS_LABEL: Record<HireBasis, string> = { per_trip: 'a trip', per_day: 'a day', per_km: 'a km', per_month: 'a month' };
export const PAID_FROM_LABEL = { bank: 'Bank', cash_on_hand: 'Cash' } as const;

export function DocBadge({ state }: { state: VehicleDocState }) {
  return <StatusBadge status={state} tone={DOC_TONE[state]} label={DOC_STATE_LABEL[state]} />;
}

function PaidFromField({ value, onChange }: { value: string; onChange: (v: 'bank' | 'cash_on_hand') => void }) {
  return (
    <Field label="Paid from">
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value as 'bank' | 'cash_on_hand')}>
          <option value="cash_on_hand">Cash</option>
          <option value="bank">Bank</option>
        </select>
      )}
    </Field>
  );
}

function FitBadge({ v }: { v: VehicleOverview }) {
  if (v.status === 'disposed') return <StatusBadge status="disposed" tone="muted" label="Disposed" />;
  if (v.status === 'maintenance') return <StatusBadge status="maintenance" tone="attention" label="In maintenance" />;
  return v.fitForTrips ? <StatusBadge status="fit" tone="done" label="Fit for trips" /> : <StatusBadge status="unfit" tone="bad" label="Not fit" />;
}

export function VehiclesTable({
  vehicles,
  currency,
  selected,
  onSelect,
}: {
  vehicles: VehicleOverview[];
  currency: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Road</th>
            <th>Attention</th>
            <th className="num">Book value / hire</th>
            <th className="num">Loan due</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.length === 0 && <EmptyRow colSpan={5}>No vehicles yet.</EmptyRow>}
          {vehicles.map((v) => (
            <SelectableRow key={v.vehicleId} selected={selected === v.vehicleId} onSelect={() => onSelect(v.vehicleId)} label={v.registrationNumber}>
              <td>
                {v.registrationNumber}
                <div className="cell-sub">
                  {v.ownership === 'hired' ? 'Hired' : 'Owned'}
                  {v.makeModel ? ` · ${v.makeModel}` : ''}
                </div>
              </td>
              <td>
                <FitBadge v={v} />
              </td>
              <td>
                {v.issues.length === 0 ? (
                  <span className="cell-sub">Nothing due</span>
                ) : (
                  <>
                    {v.issues[0]}
                    {v.issues.length > 1 && <div className="cell-sub">and {v.issues.length - 1} more</div>}
                  </>
                )}
              </td>
              <td className="num">
                {v.ownership === 'hired'
                  ? v.hireContract
                    ? `${formatMoney(v.hireContract.rate, currency)} ${BASIS_LABEL[v.hireContract.rateBasis]}`
                    : '—'
                  : v.netBookValue !== null
                    ? formatMoney(v.netBookValue, currency)
                    : '—'}
              </td>
              <td className="num">{Number(v.loanOutstanding) ? formatMoney(v.loanOutstanding, currency) : '—'}</td>
            </SelectableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Dialog =
  | 'profile'
  | 'fuel'
  | 'maintenance'
  | 'document'
  | 'capitalize'
  | 'dispose'
  | 'loan'
  | 'contract'
  | 'bill'
  | { emi: VehicleLoan };

export function VehiclePanel({
  id,
  currency,
  today,
  canWrite,
  canFinance,
  onClose,
}: {
  id: string;
  currency: string;
  today: string;
  canWrite: boolean;
  canFinance: boolean;
  onClose: () => void;
}) {
  const { data, error, isPending, refetch } = useFleetVehicle(id);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (isPending || error || !data) {
    return (
      <DetailPanel title="Vehicle" onClose={onClose}>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <SkeletonLines lines={6} />}
      </DetailPanel>
    );
  }
  const live = data.status !== 'disposed';
  const owned = data.ownership === 'owned';
  const close = () => setDialog(null);
  const due = data.maintenanceDue;
  return (
    <DetailPanel title={data.registrationNumber} onClose={onClose}>
      <p>
        <FitBadge v={data} />
      </p>
      {data.issues.length > 0 && (
        <ul className="issue-list">
          {data.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <KeyValues
        items={[
          ['Ownership', owned ? 'Owned' : 'Hired'],
          ['Make and model', data.makeModel ?? '—'],
          ['Year', data.manufactureYear ? String(data.manufactureYear) : '—'],
          ['Fuel', data.fuelType],
          ['Capacity', formatQuantity(data.capacityKg, 'kg')],
          ['Odometer', data.lastOdometerKm !== null ? `${data.lastOdometerKm.toLocaleString('en-IN')} km` : '—'],
          ['Next service', due ? [due.date ? formatDate(due.date) : null, due.km ? `${due.km.toLocaleString('en-IN')} km` : null].filter(Boolean).join(' or ') + (due.overdue ? ' — overdue' : '') : '—'],
          ...(owned
            ? ([
                ['Book value', data.netBookValue !== null ? formatMoney(data.netBookValue, currency) : 'Not on the books'],
                ['Loan outstanding', Number(data.loanOutstanding) ? formatMoney(data.loanOutstanding, currency) : '—'],
              ] as [string, string][])
            : ([
                ['Hired from', data.hireContract ? data.hireContract.ownerName : 'No contract'],
                ['Rate', data.hireContract ? `${formatMoney(data.hireContract.rate, currency)} ${BASIS_LABEL[data.hireContract.rateBasis]}${data.hireContract.includesFuel ? ', with fuel' : ''}` : '—'],
                ['Unpaid hire', Number(data.unpaidHire) ? formatMoney(data.unpaidHire, currency) : '—'],
              ] as [string, string][])),
        ]}
      />
      {live && (canWrite || canFinance) && (
        <ActionBar>
          {canWrite && (
            <>
              <button type="button" className="button button-primary" onClick={() => setDialog('fuel')}>
                Record fuel
              </button>
              <button type="button" className="button" onClick={() => setDialog('maintenance')}>
                Record maintenance
              </button>
              <button type="button" className="button" onClick={() => setDialog('document')}>
                Record a document
              </button>
              <button type="button" className="button" onClick={() => setDialog('profile')}>
                Edit details
              </button>
            </>
          )}
          {canFinance && owned && !data.asset && (
            <button type="button" className="button" onClick={() => setDialog('capitalize')}>
              Put on the books
            </button>
          )}
          {canFinance && owned && (
            <button type="button" className="button" onClick={() => setDialog('loan')}>
              Record a loan
            </button>
          )}
          {canFinance && data.asset && !data.asset.disposal && (
            <button type="button" className="button" onClick={() => setDialog('dispose')}>
              Dispose of it
            </button>
          )}
          {canFinance && !owned && (
            <button type="button" className="button" onClick={() => setDialog('contract')}>
              {data.hireContract ? 'New hire rate' : 'Hire contract'}
            </button>
          )}
          {canFinance && !owned && data.hireContracts.length > 0 && (
            <button type="button" className="button" onClick={() => setDialog('bill')}>
              Record a hire bill
            </button>
          )}
        </ActionBar>
      )}

      <h3 className="detail-subhead">Documents</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Valid until</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.allDocuments.length === 0 && <EmptyRow colSpan={3}>No documents recorded.</EmptyRow>}
            {data.allDocuments.map((d) => (
              <tr key={d.id} data-muted={d.superseded || undefined}>
                <td>
                  {DOC_LABEL[d.docType]}
                  {d.docNumber && <div className="cell-sub">{d.docNumber}</div>}
                </td>
                <td>{d.validUntil ? formatDate(d.validUntil) : '—'}</td>
                <td>{d.superseded ? <span className="cell-sub">Renewed</span> : <DocBadge state={d.state} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="detail-subhead">Maintenance</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Work</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.maintenance.length === 0 && <EmptyRow colSpan={3}>No maintenance recorded.</EmptyRow>}
            {data.maintenance.slice(0, 10).map((m) => (
              <tr key={m.id}>
                <td>{formatDate(m.serviceDate)}</td>
                <td>
                  {KIND_LABEL[m.kind]}: {m.description}
                  {(m.vendor || m.odometerKm !== null) && (
                    <div className="cell-sub">{[m.vendor, m.odometerKm !== null ? `${m.odometerKm.toLocaleString('en-IN')} km` : null].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td className="num">{Number(m.amount) ? formatMoney(m.amount, currency) : 'No charge'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="detail-subhead">Fuel</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Litres</th>
              <th className="num">Odometer</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.fuel.length === 0 && <EmptyRow colSpan={4}>No fuel recorded.</EmptyRow>}
            {data.fuel.slice(0, 10).map((f) => (
              <tr key={f.id}>
                <td>
                  {formatDate(f.filledOn)}
                  {f.station && <div className="cell-sub">{f.station}</div>}
                </td>
                <td className="num">{formatQuantity(f.litres)}</td>
                <td className="num">{f.odometerKm !== null ? f.odometerKm.toLocaleString('en-IN') : '—'}</td>
                <td className="num">{formatMoney(f.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.asset && (
        <>
          <h3 className="detail-subhead">On the books</h3>
          <KeyValues
            items={[
              ['Capitalised', `${formatMoney(data.asset.cost, currency)} on ${formatDate(data.asset.capitalizedOn)}`],
              [
                'Depreciation',
                data.asset.method === 'straight_line'
                  ? `Straight line over ${data.asset.usefulLifeMonths} months to ${formatMoney(data.asset.salvageValue, currency)}`
                  : `Written-down value at ${data.asset.annualRate}% a year, to ${formatMoney(data.asset.salvageValue, currency)}`,
              ],
              ['Charged so far', formatMoney(data.asset.accumulated, currency)],
              ['Charged through', data.asset.depreciatedThrough ? data.asset.depreciatedThrough.slice(0, 7) : 'Not yet'],
              ['Book value', formatMoney(data.asset.netBookValue, currency)],
              ...(data.asset.disposal
                ? ([
                    [
                      'Disposed',
                      `${formatDate(data.asset.disposal.disposedOn)} — ${data.asset.disposal.method.replace('_', ' ')}${data.asset.disposal.buyer ? ` to ${data.asset.disposal.buyer}` : ''} for ${formatMoney(data.asset.disposal.proceeds, currency)}`,
                    ],
                    [
                      Number(data.asset.disposal.gainLoss) >= 0 ? 'Gain on disposal' : 'Loss on disposal',
                      formatMoney(data.asset.disposal.gainLoss.replace('-', ''), currency),
                    ],
                  ] as [string, string][])
                : []),
            ]}
          />
        </>
      )}

      {data.loans.length > 0 && <h3 className="detail-subhead">Loans</h3>}
      {data.loans.map((l) => (
        <div key={l.id} className="subsection">
          <KeyValues
            items={[
              ['Lender', `${l.lender}${l.accountNumber ? ` · ${l.accountNumber}` : ''}`],
              ['Terms', `${formatMoney(l.principal, currency)} at ${l.annualRate}% over ${l.tenureMonths} months — EMI ${formatMoney(l.emi, currency)}`],
              ['Outstanding', formatMoney(l.outstanding, currency)],
              ['Interest paid', formatMoney(l.interestPaid, currency)],
              ['Next EMI', l.nextDue ? `${formatDate(l.nextDue.dueOn)} — #${l.nextDue.installmentNo}` : l.status === 'closed' ? 'Closed' : '—'],
            ]}
          />
          {canFinance && l.status === 'active' && (
            <ActionBar>
              <button type="button" className="button" onClick={() => setDialog({ emi: l })}>
                Pay EMI
              </button>
            </ActionBar>
          )}
        </div>
      ))}

      {!owned && (
        <>
          <h3 className="detail-subhead">Hire</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.hireBills.length === 0 && <EmptyRow colSpan={3}>No hire bills yet.</EmptyRow>}
                {data.hireBills.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
                      <div className="cell-sub">
                        {formatQuantity(b.quantity)} × {formatMoney(b.rate, currency)}
                      </div>
                    </td>
                    <td className="num">{formatMoney(b.amount, currency)}</td>
                    <td>{b.status === 'paid' ? <StatusBadge status="paid" tone="done" label="Paid" /> : <StatusBadge status="unpaid" tone="attention" label="Unpaid" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.hireContracts.length > 0 && (
            <p className="footnote">
              Rates:{' '}
              {data.hireContracts
                .map((c) => `${formatMoney(c.rate, currency)} ${BASIS_LABEL[c.rateBasis]} from ${formatDate(c.effectiveFrom)}${c.effectiveTo ? ` to ${formatDate(c.effectiveTo)}` : ''}`)
                .join('; ')}
            </p>
          )}
        </>
      )}

      {dialog === 'profile' && <ProfileDialog vehicle={data} onClose={close} />}
      {dialog === 'fuel' && <FuelDialog vehicle={data} currency={currency} today={today} onClose={close} />}
      {dialog === 'maintenance' && <MaintenanceDialog vehicle={data} currency={currency} today={today} onClose={close} />}
      {dialog === 'document' && <DocumentDialog vehicle={data} currency={currency} onClose={close} />}
      {dialog === 'capitalize' && <CapitalizeDialog vehicle={data} currency={currency} today={today} onClose={close} />}
      {dialog === 'dispose' && <DisposeDialog vehicle={data} currency={currency} today={today} onClose={close} />}
      {dialog === 'loan' && <LoanDialog vehicle={data} currency={currency} today={today} onClose={close} />}
      {dialog === 'contract' && <ContractDialog vehicle={data} currency={currency} onClose={close} />}
      {dialog === 'bill' && <HireBillDialog vehicle={data} currency={currency} onClose={close} />}
      {dialog !== null && typeof dialog === 'object' && <EmiDialog loan={dialog.emi} registration={data.registrationNumber} currency={currency} today={today} onClose={close} />}
    </DetailPanel>
  );
}

export function AddVehicleDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [f, setF] = useState({ registration: '', capacity: '', fuelType: 'diesel', ownership: 'owned' as 'owned' | 'hired' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction(
    async (body: { registrationNumber: string; capacityKg: number; fuelType: string; ownership: 'owned' | 'hired' }) => {
      const { ownership, ...vehicle } = body;
      const created = await apiSend<{ id: string }>('POST', 'vehicles', vehicle);
      if (ownership === 'hired') await apiSend('PUT', `fleet/vehicles/${created.id}/profile`, { version: 0, ownership });
      return created;
    },
    FLEET_WRITES,
    (created) => onAdded(created.id),
  );
  return (
    <FormDialog
      title="Add a vehicle"
      description={<p>An owned vehicle can then go on the books; a hired one gets its owner&apos;s rate.</p>}
      submitLabel="Add vehicle"
      pending={add.isPending}
      error={problem ?? add.error}
      onClose={onClose}
      onSubmit={() => {
        const capacity = parseQuantity(f.capacity, 'the capacity');
        if (f.registration.trim().length < 4) return setProblem('Enter the registration number.');
        if (!capacity.ok) return setProblem(capacity.error);
        setProblem(null);
        add.mutate({ registrationNumber: f.registration.trim().toUpperCase(), capacityKg: capacity.value, fuelType: f.fuelType, ownership: f.ownership });
      }}
    >
      <Field label="Registration number">{(p) => <input {...p} value={f.registration} onChange={(e) => set({ registration: e.target.value })} placeholder="KA01AB1234" />}</Field>
      <Field label="Capacity (kg)">{(p) => <input {...p} inputMode="decimal" value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} />}</Field>
      <Field label="Fuel">
        {(p) => (
          <select {...p} value={f.fuelType} onChange={(e) => set({ fuelType: e.target.value })}>
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
            <option value="cng">CNG</option>
            <option value="electric">Electric</option>
          </select>
        )}
      </Field>
      <Field label="Ownership">
        {(p) => (
          <select {...p} value={f.ownership} onChange={(e) => set({ ownership: e.target.value as 'owned' | 'hired' })}>
            <option value="owned">Owned</option>
            <option value="hired">Hired from someone else</option>
          </select>
        )}
      </Field>
    </FormDialog>
  );
}

function ProfileDialog({ vehicle, onClose }: { vehicle: VehicleDetail; onClose: () => void }) {
  const [ownership, setOwnership] = useState(vehicle.ownership);
  const [makeModel, setMakeModel] = useState(vehicle.makeModel ?? '');
  const [year, setYear] = useState(vehicle.manufactureYear ? String(vehicle.manufactureYear) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', `fleet/vehicles/${vehicle.vehicleId}/profile`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Details — ${vehicle.registrationNumber}`}
      submitLabel="Save"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const y = year.trim() ? parseWholeNumber(year, 'the year', 1950, 2100) : null;
        if (y && !y.ok) return setProblem(y.error);
        setProblem(null);
        save.mutate({ version: vehicle.profileVersion, ownership, makeModel: makeModel.trim() || null, manufactureYear: y ? y.value : null });
      }}
    >
      <Field label="Ownership">
        {(p) => (
          <select {...p} value={ownership} onChange={(e) => setOwnership(e.target.value as 'owned' | 'hired')}>
            <option value="owned">Owned</option>
            <option value="hired">Hired</option>
          </select>
        )}
      </Field>
      <Field label="Make and model (optional)">{(p) => <input {...p} value={makeModel} onChange={(e) => setMakeModel(e.target.value)} placeholder="Tata Ace Gold" />}</Field>
      <Field label="Year of manufacture (optional)">{(p) => <input {...p} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function FuelDialog({ vehicle, currency, today, onClose }: { vehicle: VehicleDetail; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({ filledOn: today, litres: '', amount: '', odometer: '', station: '', paidFrom: 'cash_on_hand' as 'bank' | 'cash_on_hand' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'fleet/fuel', body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Fuel — ${vehicle.registrationNumber}`}
      description={<p>Posted to vehicle fuel. Odometer readings give distance and fuel economy.</p>}
      submitLabel="Record fuel"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const litres = parseQuantity(f.litres, 'the litres');
        const amount = parseMoney(f.amount, 'the amount', true);
        const odometer = f.odometer.trim() ? parseWholeNumber(f.odometer, 'the odometer', 0, 9_999_999) : null;
        const err = firstError([litres, amount, ...(odometer ? [odometer] : [])]);
        if (err || !litres.ok || !amount.ok) return setProblem(err);
        setProblem(null);
        save.mutate({
          vehicleId: vehicle.vehicleId,
          filledOn: f.filledOn,
          litres: litres.value,
          amount: amount.value,
          odometerKm: odometer && odometer.ok ? odometer.value : undefined,
          station: optionalText(f.station),
          paidFrom: f.paidFrom,
        });
      }}
    >
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={f.filledOn} onChange={(e) => set({ filledOn: e.target.value })} />}</Field>
      <Field label="Litres">{(p) => <input {...p} inputMode="decimal" value={f.litres} onChange={(e) => set({ litres: e.target.value })} />}</Field>
      <Field label={`Amount (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
      <Field label="Odometer (km, optional)" hint={vehicle.lastOdometerKm !== null ? `Last reading ${vehicle.lastOdometerKm.toLocaleString('en-IN')} km` : undefined}>
        {(p) => <input {...p} inputMode="numeric" value={f.odometer} onChange={(e) => set({ odometer: e.target.value })} />}
      </Field>
      <Field label="Station (optional)">{(p) => <input {...p} value={f.station} onChange={(e) => set({ station: e.target.value })} />}</Field>
      <PaidFromField value={f.paidFrom} onChange={(paidFrom) => set({ paidFrom })} />
    </FormDialog>
  );
}

function MaintenanceDialog({ vehicle, currency, today, onClose }: { vehicle: VehicleDetail; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({
    serviceDate: today,
    kind: 'service' as MaintenanceKind,
    description: '',
    vendor: '',
    odometer: '',
    amount: '',
    paidFrom: 'cash_on_hand' as 'bank' | 'cash_on_hand',
    nextDueDate: '',
    nextDueKm: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'fleet/maintenance', body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Maintenance — ${vehicle.registrationNumber}`}
      description={<p>Posted to repairs and maintenance. Set when the next one is due to be reminded.</p>}
      submitLabel="Record"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const amount = parseMoney(f.amount || '0', 'the cost');
        const odometer = f.odometer.trim() ? parseWholeNumber(f.odometer, 'the odometer', 0, 9_999_999) : null;
        const nextKm = f.nextDueKm.trim() ? parseWholeNumber(f.nextDueKm, 'the next service km', 1, 9_999_999) : null;
        const err = firstError([amount, ...(odometer ? [odometer] : []), ...(nextKm ? [nextKm] : [])]);
        if (err || !amount.ok) return setProblem(err);
        if (f.description.trim().length < 3) return setProblem('Say what was done.');
        setProblem(null);
        save.mutate({
          vehicleId: vehicle.vehicleId,
          serviceDate: f.serviceDate,
          kind: f.kind,
          description: f.description.trim(),
          vendor: optionalText(f.vendor),
          odometerKm: odometer && odometer.ok ? odometer.value : undefined,
          amount: amount.value,
          paidFrom: amount.value > 0 ? f.paidFrom : undefined,
          nextDueDate: f.nextDueDate || undefined,
          nextDueKm: nextKm && nextKm.ok ? nextKm.value : undefined,
        });
      }}
    >
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={f.serviceDate} onChange={(e) => set({ serviceDate: e.target.value })} />}</Field>
      <Field label="Kind">
        {(p) => (
          <select {...p} value={f.kind} onChange={(e) => set({ kind: e.target.value as MaintenanceKind })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="What was done" wide>
        {(p) => <input {...p} value={f.description} onChange={(e) => set({ description: e.target.value })} />}
      </Field>
      <Field label="Garage (optional)">{(p) => <input {...p} value={f.vendor} onChange={(e) => set({ vendor: e.target.value })} />}</Field>
      <Field label="Odometer (km, optional)">{(p) => <input {...p} inputMode="numeric" value={f.odometer} onChange={(e) => set({ odometer: e.target.value })} />}</Field>
      <Field label={`Cost (${currency})`} hint="Blank or 0 for work under warranty">
        {(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}
      </Field>
      <PaidFromField value={f.paidFrom} onChange={(paidFrom) => set({ paidFrom })} />
      <Field label="Next due on (optional)">{(p) => <input {...p} type="date" value={f.nextDueDate} onChange={(e) => set({ nextDueDate: e.target.value })} />}</Field>
      <Field label="Next due at km (optional)">{(p) => <input {...p} inputMode="numeric" value={f.nextDueKm} onChange={(e) => set({ nextDueKm: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function DocumentDialog({ vehicle, currency, onClose }: { vehicle: VehicleDetail; currency: string; onClose: () => void }) {
  const [f, setF] = useState({
    docType: 'insurance' as VehicleDocType,
    docNumber: '',
    issuer: '',
    validFrom: '',
    validUntil: '',
    amount: '',
    paidFrom: 'bank' as 'bank' | 'cash_on_hand',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'fleet/documents', body), FLEET_WRITES, onClose);
  const needsExpiry = f.docType !== 'registration' && f.docType !== 'other';
  return (
    <FormDialog
      title={`Document — ${vehicle.registrationNumber}`}
      description={<p>A renewal is recorded as a new document; the latest of each kind is the one in force. An expired one keeps the vehicle off trips.</p>}
      submitLabel="Record"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const amount = parseOptionalMoney(f.amount, 'the amount paid');
        if (!amount.ok) return setProblem(amount.error);
        if (needsExpiry && !f.validUntil) return setProblem('Enter the date it is valid until.');
        setProblem(null);
        save.mutate({
          vehicleId: vehicle.vehicleId,
          docType: f.docType,
          docNumber: optionalText(f.docNumber),
          issuer: optionalText(f.issuer),
          validFrom: f.validFrom || undefined,
          validUntil: f.validUntil || undefined,
          amount: amount.value,
          paidFrom: amount.value ? f.paidFrom : undefined,
        });
      }}
    >
      <Field label="Document">
        {(p) => (
          <select {...p} value={f.docType} onChange={(e) => set({ docType: e.target.value as VehicleDocType })}>
            {Object.entries(DOC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Number (optional)">{(p) => <input {...p} value={f.docNumber} onChange={(e) => set({ docNumber: e.target.value })} />}</Field>
      <Field label="Issued by (optional)">{(p) => <input {...p} value={f.issuer} onChange={(e) => set({ issuer: e.target.value })} />}</Field>
      <Field label="Valid from (optional)">{(p) => <input {...p} type="date" value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />}</Field>
      <Field label={needsExpiry ? 'Valid until' : 'Valid until (optional)'}>{(p) => <input {...p} type="date" value={f.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />}</Field>
      <Field label={`Premium or fee paid (${currency}, optional)`}>{(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
      {f.amount.trim() !== '' && <PaidFromField value={f.paidFrom} onChange={(paidFrom) => set({ paidFrom })} />}
    </FormDialog>
  );
}

function CapitalizeDialog({ vehicle, currency, today, onClose }: { vehicle: VehicleDetail; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({
    capitalizedOn: today,
    cost: '',
    salvage: '',
    method: 'straight_line' as 'straight_line' | 'written_down',
    life: '96',
    rate: '15',
    fundedBy: 'bank' as 'bank' | 'cash_on_hand' | 'owner_capital',
    opening: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `fleet/vehicles/${vehicle.vehicleId}/capitalize`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Put on the books — ${vehicle.registrationNumber}`}
      description={<p>The vehicle becomes an asset at cost and is depreciated month by month. Bought on a loan? Record the loan first, then say it was paid from the bank.</p>}
      submitLabel="Capitalise"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const cost = parseMoney(f.cost, 'the cost', true);
        const salvage = parseMoney(f.salvage || '0', 'the salvage value');
        const opening = parseMoney(f.opening || '0', 'the depreciation already charged');
        const life = f.method === 'straight_line' ? parseWholeNumber(f.life, 'the useful life', 1, 600) : null;
        const rate = f.method === 'written_down' ? parseDecimal(f.rate, 'the rate', { decimals: 2, positive: true, max: 100 }) : null;
        const err = firstError([cost, salvage, opening, ...(life ? [life] : []), ...(rate ? [rate] : [])]);
        if (err || !cost.ok || !salvage.ok || !opening.ok) return setProblem(err);
        setProblem(null);
        save.mutate({
          capitalizedOn: f.capitalizedOn,
          cost: cost.value,
          salvageValue: salvage.value,
          method: f.method,
          usefulLifeMonths: life && life.ok ? life.value : undefined,
          annualRate: rate && rate.ok ? rate.value : undefined,
          fundedBy: f.fundedBy,
          openingAccumulated: opening.value || undefined,
        });
      }}
    >
      <Field label="From">{(p) => <input {...p} type="date" max={today} value={f.capitalizedOn} onChange={(e) => set({ capitalizedOn: e.target.value })} />}</Field>
      <Field label={`Cost (${currency})`} hint="Price plus registration and getting it on the road">
        {(p) => <input {...p} inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} />}
      </Field>
      <Field label={`Salvage value (${currency})`} hint="What it'll be worth at the end">
        {(p) => <input {...p} inputMode="decimal" value={f.salvage} onChange={(e) => set({ salvage: e.target.value })} />}
      </Field>
      <Field label="Method">
        {(p) => (
          <select {...p} value={f.method} onChange={(e) => set({ method: e.target.value as typeof f.method })}>
            <option value="straight_line">Straight line — the same each month</option>
            <option value="written_down">Written-down value — a percentage of what's left</option>
          </select>
        )}
      </Field>
      {f.method === 'straight_line' ? (
        <Field label="Useful life (months)">{(p) => <input {...p} inputMode="numeric" value={f.life} onChange={(e) => set({ life: e.target.value })} />}</Field>
      ) : (
        <Field label="Rate (% a year)" hint="15% is the Companies Act rate for goods vehicles">
          {(p) => <input {...p} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />}
        </Field>
      )}
      <Field label="Paid for from">
        {(p) => (
          <select {...p} value={f.fundedBy} onChange={(e) => set({ fundedBy: e.target.value as typeof f.fundedBy })}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash</option>
            <option value="owner_capital">Brought in by the owner</option>
          </select>
        )}
      </Field>
      <Field label={`Depreciation already charged (${currency}, optional)`} hint="Only for a vehicle owned before these books began">
        {(p) => <input {...p} inputMode="decimal" value={f.opening} onChange={(e) => set({ opening: e.target.value })} />}
      </Field>
    </FormDialog>
  );
}

function DisposeDialog({ vehicle, currency, today, onClose }: { vehicle: VehicleDetail; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({ disposedOn: today, method: 'sold' as 'sold' | 'scrapped' | 'written_off', proceeds: '', receivedInto: 'bank' as 'bank' | 'cash_on_hand', buyer: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `fleet/vehicles/${vehicle.vehicleId}/dispose`, body), FLEET_WRITES, onClose);
  const asset = vehicle.asset!;
  return (
    <FormDialog
      title={`Dispose of ${vehicle.registrationNumber}`}
      tone="danger"
      description={
        <p>
          Book value {formatMoney(asset.netBookValue, currency)}, depreciated through {asset.depreciatedThrough ? asset.depreciatedThrough.slice(0, 7) : 'nothing yet'}. The
          proceeds against book value post a gain or loss, and the vehicle comes off the road for good.
        </p>
      }
      submitLabel="Record disposal"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const proceeds = parseMoney(f.proceeds || '0', 'the proceeds');
        if (!proceeds.ok) return setProblem(proceeds.error);
        setProblem(null);
        save.mutate({
          disposedOn: f.disposedOn,
          method: f.method,
          proceeds: proceeds.value,
          receivedInto: proceeds.value > 0 ? f.receivedInto : undefined,
          buyer: optionalText(f.buyer),
        });
      }}
    >
      <Field label="Date">{(p) => <input {...p} type="date" max={today} value={f.disposedOn} onChange={(e) => set({ disposedOn: e.target.value })} />}</Field>
      <Field label="How">
        {(p) => (
          <select {...p} value={f.method} onChange={(e) => set({ method: e.target.value as typeof f.method })}>
            <option value="sold">Sold</option>
            <option value="scrapped">Scrapped</option>
            <option value="written_off">Written off (e.g. total loss)</option>
          </select>
        )}
      </Field>
      <Field label={`Proceeds (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.proceeds} onChange={(e) => set({ proceeds: e.target.value })} />}</Field>
      <Field label="Received into">
        {(p) => (
          <select {...p} value={f.receivedInto} onChange={(e) => set({ receivedInto: e.target.value as typeof f.receivedInto })}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash</option>
          </select>
        )}
      </Field>
      <Field label="Buyer (optional)">{(p) => <input {...p} value={f.buyer} onChange={(e) => set({ buyer: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function LoanDialog({ vehicle, currency, today, onClose }: { vehicle: VehicleDetail; currency: string; today: string; onClose: () => void }) {
  const [f, setF] = useState({ lender: '', account: '', principal: '', rate: '', tenure: '60', emi: '', disbursedOn: today, firstEmiOn: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', 'fleet/loans', body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Loan — ${vehicle.registrationNumber}`}
      description={<p>The loan comes into the bank. Each EMI pays the month&apos;s interest first, then principal.</p>}
      submitLabel="Record loan"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const principal = parseMoney(f.principal, 'the loan amount', true);
        const rate = parseDecimal(f.rate || '0', 'the interest rate', { decimals: 2, max: 60 });
        const tenure = parseWholeNumber(f.tenure, 'the tenure', 1, 360);
        const emi = parseOptionalMoney(f.emi, 'the EMI');
        const err = firstError([principal, rate, tenure, emi]);
        if (err || !principal.ok || !rate.ok || !tenure.ok || !emi.ok) return setProblem(err);
        if (f.lender.trim().length < 2) return setProblem('Enter the lender.');
        if (!f.firstEmiOn) return setProblem('Enter the date of the first EMI.');
        setProblem(null);
        save.mutate({
          vehicleId: vehicle.vehicleId,
          lender: f.lender.trim(),
          accountNumber: optionalText(f.account),
          principal: principal.value,
          annualRate: rate.value,
          tenureMonths: tenure.value,
          emi: emi.value,
          disbursedOn: f.disbursedOn,
          firstEmiOn: f.firstEmiOn,
        });
      }}
    >
      <Field label="Lender">{(p) => <input {...p} value={f.lender} onChange={(e) => set({ lender: e.target.value })} />}</Field>
      <Field label="Loan account (optional)">{(p) => <input {...p} value={f.account} onChange={(e) => set({ account: e.target.value })} />}</Field>
      <Field label={`Amount (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.principal} onChange={(e) => set({ principal: e.target.value })} />}</Field>
      <Field label="Interest (% a year)">{(p) => <input {...p} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />}</Field>
      <Field label="Tenure (months)">{(p) => <input {...p} inputMode="numeric" value={f.tenure} onChange={(e) => set({ tenure: e.target.value })} />}</Field>
      <Field label={`EMI (${currency}, optional)`} hint="Blank works it out; enter the lender's figure if it differs">
        {(p) => <input {...p} inputMode="decimal" value={f.emi} onChange={(e) => set({ emi: e.target.value })} />}
      </Field>
      <Field label="Disbursed on">{(p) => <input {...p} type="date" max={today} value={f.disbursedOn} onChange={(e) => set({ disbursedOn: e.target.value })} />}</Field>
      <Field label="First EMI on">{(p) => <input {...p} type="date" value={f.firstEmiOn} onChange={(e) => set({ firstEmiOn: e.target.value })} />}</Field>
    </FormDialog>
  );
}

export function EmiDialog({ loan, registration, currency, today, onClose }: { loan: VehicleLoan; registration: string; currency: string; today: string; onClose: () => void }) {
  const next = loan.nextDue;
  const [f, setF] = useState({ paidOn: next && next.dueOn <= today ? next.dueOn : today, amount: next ? next.payment : '', paidFrom: 'bank' as 'bank' | 'cash_on_hand', reference: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `fleet/loans/${loan.id}/payments`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`EMI — ${registration}, ${loan.lender}`}
      description={
        next && (
          <p>
            Installment {next.installmentNo}: interest {formatMoney(next.interest, currency)}, principal {formatMoney(next.principal, currency)}. Outstanding{' '}
            {formatMoney(loan.outstanding, currency)}.
          </p>
        )
      }
      submitLabel="Record payment"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const amount = parseMoney(f.amount, 'the amount', true);
        if (!amount.ok) return setProblem(amount.error);
        setProblem(null);
        save.mutate({ version: loan.version, paidOn: f.paidOn, amount: amount.value, paidFrom: f.paidFrom, reference: optionalText(f.reference) });
      }}
    >
      <Field label="Paid on">{(p) => <input {...p} type="date" max={today} value={f.paidOn} onChange={(e) => set({ paidOn: e.target.value })} />}</Field>
      <Field label={`Amount (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
      <PaidFromField value={f.paidFrom} onChange={(paidFrom) => set({ paidFrom })} />
      <Field label="Reference (optional)">{(p) => <input {...p} value={f.reference} onChange={(e) => set({ reference: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function ContractDialog({ vehicle, currency, onClose }: { vehicle: VehicleDetail; currency: string; onClose: () => void }) {
  const current = vehicle.hireContract;
  const [f, setF] = useState({
    ownerName: current?.ownerName ?? '',
    ownerPan: current?.ownerPan ?? '',
    ownerPhone: current?.ownerPhone ?? '',
    rateBasis: (current?.rateBasis ?? 'per_trip') as HireBasis,
    rate: '',
    includesFuel: current?.includesFuel ?? false,
    effectiveFrom: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('POST', `fleet/vehicles/${vehicle.vehicleId}/hire-contracts`, body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Hire rate — ${vehicle.registrationNumber}`}
      description={<p>{current ? 'The current rate ends the day before this one starts.' : "Who owns it and what you pay them. The owner's PAN decides the TDS rate."}</p>}
      submitLabel="Save rate"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const rate = parseMoney(f.rate, 'the rate', true);
        if (!rate.ok) return setProblem(rate.error);
        if (f.ownerName.trim().length < 2) return setProblem("Enter the owner's name.");
        const pan = f.ownerPan.trim().toUpperCase();
        if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return setProblem('A PAN is 5 letters, 4 digits, 1 letter.');
        if (!f.effectiveFrom) return setProblem('Choose the date it starts.');
        setProblem(null);
        save.mutate({
          ownerName: f.ownerName.trim(),
          ownerPan: pan || undefined,
          ownerPhone: optionalText(f.ownerPhone),
          rateBasis: f.rateBasis,
          rate: rate.value,
          includesFuel: f.includesFuel,
          effectiveFrom: f.effectiveFrom,
        });
      }}
    >
      <Field label="Owner">{(p) => <input {...p} value={f.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />}</Field>
      <Field label="Owner's PAN (optional)">{(p) => <input {...p} value={f.ownerPan} onChange={(e) => set({ ownerPan: e.target.value })} />}</Field>
      <Field label="Owner's phone (optional)">{(p) => <input {...p} type="tel" value={f.ownerPhone} onChange={(e) => set({ ownerPhone: e.target.value })} />}</Field>
      <Field label="Paid">
        {(p) => (
          <select {...p} value={f.rateBasis} onChange={(e) => set({ rateBasis: e.target.value as HireBasis })}>
            <option value="per_trip">Per trip</option>
            <option value="per_day">Per day used</option>
            <option value="per_km">Per km</option>
            <option value="per_month">Per month</option>
          </select>
        )}
      </Field>
      <Field label={`Rate (${currency})`}>{(p) => <input {...p} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />}</Field>
      <Field label="Fuel">
        {(p) => (
          <select {...p} value={f.includesFuel ? 'yes' : 'no'} onChange={(e) => set({ includesFuel: e.target.value === 'yes' })}>
            <option value="no">We pay for fuel</option>
            <option value="yes">The rate includes fuel</option>
          </select>
        )}
      </Field>
      <Field label="Starts on">{(p) => <input {...p} type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function HireBillDialog({ vehicle, currency, onClose }: { vehicle: VehicleDetail; currency: string; onClose: () => void }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const suggestion = useHireSuggestion(vehicle.vehicleId, range.from && range.to ? range : null);
  const s = suggestion.data;
  const save = useAction((body: unknown) => apiSend('POST', 'fleet/hire-bills', body), FLEET_WRITES, onClose);
  return (
    <FormDialog
      title={`Hire bill — ${vehicle.registrationNumber}`}
      description={<p>What the owner is owed for a period, counted from the trips the vehicle ran. It stays unpaid until you pay it.</p>}
      submitLabel="Record bill"
      pending={save.isPending}
      error={problem ?? save.error}
      onClose={onClose}
      onSubmit={() => {
        const q = parseQuantity(quantity || s?.quantity || '', 'the quantity');
        const a = parseOptionalMoney(amount, 'the bill total');
        const err = firstError([q, a]);
        if (err || !q.ok || !a.ok) return setProblem(err);
        if (!range.from || !range.to) return setProblem('Choose the period.');
        setProblem(null);
        save.mutate({ vehicleId: vehicle.vehicleId, periodStart: range.from, periodEnd: range.to, quantity: q.value, amount: a.value, billReference: optionalText(reference) });
      }}
    >
      <Field label="From">{(p) => <input {...p} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
      <Field label="To">{(p) => <input {...p} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
      {s && (
        <p className="field-note" role="status">
          {s.contract ? `${formatMoney(s.contract.rate, currency)} ${BASIS_LABEL[s.contract.rateBasis]} — ` : ''}
          {s.basis}
          {s.overlapping ? `. ${s.overlapping}.` : ''}
        </p>
      )}
      <Field label="Quantity" hint={s?.quantity ? `Counted: ${formatQuantity(s.quantity)}` : 'Trips, days, km or months'}>
        {(p) => <input {...p} inputMode="decimal" value={quantity} placeholder={s?.quantity ?? ''} onChange={(e) => setQuantity(e.target.value)} />}
      </Field>
      <Field label={`Bill total (${currency}, optional)`} hint="Only if the owner's bill differs from quantity × rate">
        {(p) => <input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Owner's bill number (optional)">{(p) => <input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
    </FormDialog>
  );
}
