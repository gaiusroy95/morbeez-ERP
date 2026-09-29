'use client';

import { useState } from 'react';
import type {
  AssetRow,
  DepreciationRunResult,
  FleetSettings,
  FuelRecord,
  HireBill,
  VehicleEconomicsReport,
  VehicleLoan,
  VehicleOverview,
} from '@morbeez/shared-types';
import { ActionBar, Field, FormDialog } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, FilterTabs } from '@/components/ui/ListControls';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatDate, formatMoney, formatQuantity } from '@/lib/format';
import { parseWholeNumber } from '@/lib/parse';
import { EmiDialog, FLEET_WRITES, PAID_FROM_LABEL } from './Vehicles';

const sum = (values: string[]) => values.reduce((s, v) => s + Math.round(Number(v) * 100), 0) / 100;

export function FuelLogView({ rows, vehicles, currency }: { rows: FuelRecord[]; vehicles: VehicleOverview[]; currency: string }) {
  const reg = new Map(vehicles.map((v) => [v.vehicleId, v.registrationNumber]));
  const litres = rows.reduce((s, r) => s + Number(r.litres), 0);
  const amount = sum(rows.map((r) => r.amount));
  return (
    <>
      <Figures
        items={[
          { label: 'Fills', value: String(rows.length) },
          { label: 'Litres', value: formatQuantity(litres.toFixed(3)) },
          { label: 'Spent', value: formatMoney(amount.toFixed(2), currency) },
          { label: 'Average price', value: litres > 0 ? `${formatMoney((amount / litres).toFixed(2), currency)} / L` : '—' },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th className="num">Litres</th>
              <th className="num">Odometer</th>
              <th>Paid from</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No fuel recorded in this period.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {formatDate(r.filledOn)}
                  {r.station && <div className="cell-sub">{r.station}</div>}
                </td>
                <td>{reg.get(r.vehicleId) ?? '—'}</td>
                <td className="num">{formatQuantity(r.litres)}</td>
                <td className="num">{r.odometerKm !== null ? r.odometerKm.toLocaleString('en-IN') : '—'}</td>
                <td>{PAID_FROM_LABEL[r.paidFrom]}</td>
                <td className="num">{formatMoney(r.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">Record a fill from the vehicle&apos;s panel under Fleet. Fuel a driver paid for on a trip is a trip expense, counted in the cost report.</p>
    </>
  );
}

export function AssetsView({ rows, currency, today, canFinance }: { rows: AssetRow[]; currency: string; today: string; canFinance: boolean }) {
  const [running, setRunning] = useState(false);
  const live = rows.filter((r) => !r.disposedOn);
  return (
    <>
      <Figures
        items={[
          { label: 'Vehicles on the books', value: String(live.length) },
          { label: 'Cost', value: formatMoney(sum(live.map((r) => r.cost)).toFixed(2), currency) },
          { label: 'Depreciation charged', value: formatMoney(sum(live.map((r) => r.accumulated)).toFixed(2), currency) },
          { label: 'Book value', value: formatMoney(sum(live.map((r) => r.netBookValue)).toFixed(2), currency) },
        ]}
      />
      {canFinance && live.length > 0 && (
        <ActionBar>
          <button type="button" className="button button-primary" onClick={() => setRunning(true)}>
            Run depreciation
          </button>
        </ActionBar>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Method</th>
              <th className="num">Cost</th>
              <th className="num">Charged</th>
              <th className="num">Book value</th>
              <th>Through</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No vehicle is on the books yet — put an owned one on from its panel under Fleet.</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.vehicleId} data-muted={r.disposedOn ? true : undefined}>
                <td>
                  {r.registrationNumber}
                  <div className="cell-sub">{r.disposedOn ? `Disposed ${formatDate(r.disposedOn)}` : `Since ${formatDate(r.capitalizedOn)}`}</div>
                </td>
                <td>{r.method === 'straight_line' ? 'Straight line' : 'Written-down value'}</td>
                <td className="num">{formatMoney(r.cost, currency)}</td>
                <td className="num">{formatMoney(r.accumulated, currency)}</td>
                <td className="num">{formatMoney(r.netBookValue, currency)}</td>
                <td>{r.depreciatedThrough ? r.depreciatedThrough.slice(0, 7) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">Depreciation is charged month by month, one entry per month dated its last day. A vehicle is disposed of from its panel, after depreciation through the month before.</p>
      {running && <RunDepreciationDialog today={today} currency={currency} onClose={() => setRunning(false)} />}
    </>
  );
}

function RunDepreciationDialog({ today, currency, onClose }: { today: string; currency: string; onClose: () => void }) {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const [month, setMonth] = useState(last);
  const [result, setResult] = useState<DepreciationRunResult | null>(null);
  const run = useAction((body: { throughMonth: string }) => apiSend<DepreciationRunResult>('POST', 'fleet/depreciation/run', body), FLEET_WRITES, setResult);
  if (result) {
    return (
      <FormDialog title="Depreciation charged" submitLabel="Done" pending={false} error={null} onClose={onClose} onSubmit={onClose}>
        <ul className="issue-list" style={{ color: 'inherit' }}>
          {result.months.map((r) => (
            <li key={r.month}>
              {r.month}: {formatMoney(r.total, currency)} across {r.vehicles} vehicle{r.vehicles === 1 ? '' : 's'}
            </li>
          ))}
        </ul>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title="Run depreciation"
      description={<p>Charges every vehicle on the books from where it left off, through the month you choose. The month has to be over, and open in the books.</p>}
      submitLabel="Charge depreciation"
      pending={run.isPending}
      error={run.error}
      onClose={onClose}
      onSubmit={() => run.mutate({ throughMonth: month })}
    >
      <Field label="Through">{(p) => <input {...p} type="month" max={last} value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
    </FormDialog>
  );
}

export function LoansView({ rows, currency, today, canFinance }: { rows: VehicleLoan[]; currency: string; today: string; canFinance: boolean }) {
  const [paying, setPaying] = useState<VehicleLoan | null>(null);
  const active = rows.filter((l) => l.status === 'active');
  const dueNow = active.filter((l) => l.nextDue && l.nextDue.dueOn <= today);
  return (
    <>
      <Figures
        items={[
          { label: 'Active loans', value: String(active.length) },
          { label: 'Outstanding', value: formatMoney(sum(active.map((l) => l.outstanding)).toFixed(2), currency) },
          { label: 'Monthly EMIs', value: formatMoney(sum(active.map((l) => l.emi)).toFixed(2), currency) },
          { label: 'EMIs due', value: String(dueNow.length), tone: dueNow.length ? 'attention' : undefined },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Lender</th>
              <th className="num">EMI</th>
              <th className="num">Outstanding</th>
              <th>Next due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No vehicle loans. Record one from the vehicle&apos;s panel under Fleet.</EmptyRow>}
            {rows.map((l) => (
              <tr key={l.id} data-muted={l.status === 'closed' || undefined}>
                <td>{l.registrationNumber}</td>
                <td>
                  {l.lender}
                  <div className="cell-sub">
                    {l.annualRate}% · {l.payments.length} of {l.payments.length + l.schedule.length} paid
                  </div>
                </td>
                <td className="num">{formatMoney(l.emi, currency)}</td>
                <td className="num">{formatMoney(l.outstanding, currency)}</td>
                <td data-tone={l.nextDue && l.nextDue.dueOn <= today ? 'attention' : undefined}>
                  {l.status === 'closed' ? 'Closed' : l.nextDue ? formatDate(l.nextDue.dueOn) : '—'}
                </td>
                <td>
                  {canFinance && l.status === 'active' && (
                    <button type="button" className="button" onClick={() => setPaying(l)}>
                      Pay EMI
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paying && <EmiDialog loan={paying} registration={paying.registrationNumber ?? ''} currency={currency} today={today} onClose={() => setPaying(null)} />}
    </>
  );
}

export function HireBillsView({
  rows,
  status,
  onStatus,
  currency,
  today,
  canFinance,
}: {
  rows: HireBill[];
  status: string;
  onStatus: (s: string) => void;
  currency: string;
  today: string;
  canFinance: boolean;
}) {
  const [paying, setPaying] = useState<HireBill | null>(null);
  const unpaid = rows.filter((b) => b.status === 'unpaid');
  return (
    <>
      <FilterTabs
        label="Bill status"
        options={[
          { value: 'unpaid', label: 'Unpaid' },
          { value: 'paid', label: 'Paid' },
          { value: 'all', label: 'All' },
        ]}
        value={status as 'unpaid' | 'paid' | 'all'}
        onChange={onStatus}
      />
      {status !== 'paid' && <Figures items={[{ label: 'Owed to vehicle owners', value: formatMoney(sum(unpaid.map((b) => b.amount)).toFixed(2), currency) }]} />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Period</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No hire bills here. Record one from a hired vehicle&apos;s panel under Fleet.</EmptyRow>}
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.registrationNumber}
                  <div className="cell-sub">{b.ownerName}</div>
                </td>
                <td>
                  {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
                  <div className="cell-sub">
                    {formatQuantity(b.quantity)} × {formatMoney(b.rate, currency)}
                    {b.billReference ? ` · bill ${b.billReference}` : ''}
                  </div>
                </td>
                <td className="num">{formatMoney(b.amount, currency)}</td>
                <td>
                  {b.status === 'paid' ? (
                    <>
                      <StatusBadge status="paid" tone="done" label="Paid" />
                      <div className="cell-sub">
                        {b.paidOn ? formatDate(b.paidOn) : ''}
                        {Number(b.tdsAmount) ? ` · TDS ${formatMoney(b.tdsAmount, currency)} (${b.tdsSection})` : ''}
                      </div>
                    </>
                  ) : (
                    <StatusBadge status="unpaid" tone="attention" label="Unpaid" />
                  )}
                </td>
                <td>
                  {canFinance && b.status === 'unpaid' && (
                    <button type="button" className="button" onClick={() => setPaying(b)}>
                      Pay
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paying && <PayHireDialog bill={paying} currency={currency} today={today} onClose={() => setPaying(null)} />}
    </>
  );
}

function PayHireDialog({ bill, currency, today, onClose }: { bill: HireBill; currency: string; today: string; onClose: () => void }) {
  const [paidOn, setPaidOn] = useState(today);
  const [paidFrom, setPaidFrom] = useState<'bank' | 'cash_on_hand'>('bank');
  const [section, setSection] = useState('');
  const pay = useAction((body: unknown) => apiSend('POST', `fleet/hire-bills/${bill.id}/pay`, body), [...FLEET_WRITES, KEYS.tax], onClose);
  return (
    <FormDialog
      title={`Pay ${bill.ownerName}`}
      description={
        <p>
          {bill.registrationNumber}, {formatDate(bill.periodStart)} – {formatDate(bill.periodEnd)}: {formatMoney(bill.amount, currency)}. Withheld TDS goes to the TDS register
          for the quarter&apos;s return.
        </p>
      }
      submitLabel="Record payment"
      pending={pay.isPending}
      error={pay.error}
      onClose={onClose}
      onSubmit={() => pay.mutate({ version: bill.version, paidOn, paidFrom, tdsSectionCode: section || undefined })}
    >
      <Field label="Paid on">{(p) => <input {...p} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
      <Field label="Paid from">
        {(p) => (
          <select {...p} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as 'bank' | 'cash_on_hand')}>
            <option value="bank">Bank</option>
            <option value="cash_on_hand">Cash</option>
          </select>
        )}
      </Field>
      <Field label="TDS" hint="A transporter with up to 10 goods carriages who has given a PAN and a declaration is exempt">
        {(p) => (
          <select {...p} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">No TDS</option>
            <option value="194C">194C — transport contract</option>
          </select>
        )}
      </Field>
    </FormDialog>
  );
}

export function EconomicsView({ report }: { report: VehicleEconomicsReport }) {
  const c = report.currency;
  const t = report.totals;
  const money = (v: string) => (Number(v) ? formatMoney(v, c) : '—');
  return (
    <>
      <Figures
        items={[
          { label: 'Fleet cost', value: formatMoney(t.total, c) },
          { label: 'Trips', value: String(t.trips) },
          { label: 'Cost per trip', value: t.trips ? formatMoney((Number(t.total) / t.trips).toFixed(2), c) : '—' },
          { label: 'Fuel', value: formatMoney(t.fuel, c) },
        ]}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th className="num">Trips</th>
              <th className="num">Km</th>
              <th className="num">Km / L</th>
              <th className="num">Fuel</th>
              <th className="num">Maintenance</th>
              <th className="num">Documents</th>
              <th className="num">Depreciation</th>
              <th className="num">Interest</th>
              <th className="num">Hire</th>
              <th className="num">Total</th>
              <th className="num">Per trip</th>
              <th className="num">Per km</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && <EmptyRow colSpan={13}>No vehicle ran or cost anything in this period.</EmptyRow>}
            {report.rows.map((r) => (
              <tr key={r.vehicleId}>
                <td>
                  {r.registrationNumber}
                  <div className="cell-sub">
                    {r.ownership === 'hired' ? 'Hired' : 'Owned'} · {r.daysUsed} day{r.daysUsed === 1 ? '' : 's'} used
                  </div>
                </td>
                <td className="num">{r.trips}</td>
                <td className="num">{r.km !== null ? r.km.toLocaleString('en-IN') : '—'}</td>
                <td className="num">{r.kmPerLitre ?? '—'}</td>
                <td className="num">{money(r.fuel)}</td>
                <td className="num">{money(r.maintenance)}</td>
                <td className="num">{money(r.documents)}</td>
                <td className="num">{money(r.depreciation)}</td>
                <td className="num">{money(r.loanInterest)}</td>
                <td className="num">{money(r.hire)}</td>
                <td className="num strong">{formatMoney(r.total, c)}</td>
                <td className="num">{r.costPerTrip ? formatMoney(r.costPerTrip, c) : '—'}</td>
                <td className="num">{r.costPerKm ? formatMoney(r.costPerKm, c) : '—'}</td>
              </tr>
            ))}
            {report.rows.length > 1 && (
              <tr className="total-row">
                <td>All vehicles</td>
                <td className="num">{t.trips}</td>
                <td className="num">{t.km !== null ? t.km.toLocaleString('en-IN') : '—'}</td>
                <td className="num" />
                <td className="num">{money(t.fuel)}</td>
                <td className="num">{money(t.maintenance)}</td>
                <td className="num">{money(t.documents)}</td>
                <td className="num">{money(t.depreciation)}</td>
                <td className="num">{money(t.loanInterest)}</td>
                <td className="num">{money(t.hire)}</td>
                <td className="num">{formatMoney(t.total, c)}</td>
                <td className="num" />
                <td className="num" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Fuel is the fuel log plus fuel spent on trips. Km comes from odometer readings at fills. Depreciation counts the months that start in the period; hire, the bills whose period
        ends in it; interest, the EMIs paid in it.
      </p>
    </>
  );
}

export function FleetSettingsView({ settings, canWrite }: { settings: FleetSettings; canWrite: boolean }) {
  const [days, setDays] = useState(String(settings.documentReminderDays));
  const [block, setBlock] = useState(settings.blockTripsOnExpired);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((body: unknown) => apiSend('PUT', 'fleet/settings', body), [KEYS.fleet]);
  const dirty = days !== String(settings.documentReminderDays) || block !== settings.blockTripsOnExpired;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const d = parseWholeNumber(days, 'the reminder days', 0, 365);
        if (!d.ok) return setProblem(d.error);
        setProblem(null);
        save.mutate({ version: settings.version, documentReminderDays: d.value, blockTripsOnExpired: block });
      }}
    >
      <Field label="Remind about documents (days before expiry)">
        {(p) => <input {...p} inputMode="numeric" disabled={!canWrite} value={days} onChange={(e) => setDays(e.target.value)} />}
      </Field>
      <Field label="An expired document">
        {(p) => (
          <select {...p} disabled={!canWrite} value={block ? 'block' : 'warn'} onChange={(e) => setBlock(e.target.value === 'block')}>
            <option value="block">Keeps the vehicle off trips</option>
            <option value="warn">Only shows a warning</option>
          </select>
        )}
      </Field>
      {canWrite && (
        <div className="form-wide action-bar" style={{ marginTop: 0 }}>
          <button type="submit" className="button button-primary" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {problem || save.error ? <span className="form-error">{problem ?? (save.error as Error).message}</span> : null}
        </div>
      )}
    </form>
  );
}
