'use client';

import { useEffect, useState } from 'react';
import type { CashMovementKind } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyRow, Figures, FilterTabs, PageHeader, SelectableRow } from '@/components/ui/ListControls';
import { DetailPanel } from '@/components/ui/DetailPanel';
import { AgingBar } from '@/components/finance/AgingBar';
import { CashChart } from '@/components/finance/CashChart';
import { useCashFlow, usePayables, useReceivables, useTripCash, useUnsettledLots } from '@/lib/hooks/use-modules';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { daysSince, formatDate, formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { sumMoney } from '@/lib/decimal';

type Section = 'receivables' | 'payables' | 'cash' | 'trips';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'receivables', label: 'Receivables' },
  { value: 'payables', label: 'Farmer payables' },
  { value: 'cash', label: 'Cash flow' },
  { value: 'trips', label: 'Trip cash' },
];

function useTimeZone() {
  return useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
}

// ---- Receivables ----

function Receivables() {
  const { data, error, isPending, refetch } = useReceivables();
  const timeZone = useTimeZone();
  if (isPending) return <Panel title="Receivables"><SkeletonLines lines={6} /></Panel>;
  if (error) return <Panel title="Receivables"><ErrorState error={error} onRetry={() => refetch()} /></Panel>;

  const { currency, customers, totals } = data;
  const buckets = {
    notYetDue: totals.notYetDue,
    overdue1To30: sumMoney(customers.map((c) => c.overdue1To30)),
    overdue31To60: sumMoney(customers.map((c) => c.overdue31To60)),
    overdueOver60: sumMoney(customers.map((c) => c.overdueOver60)),
  };
  const owing = customers.filter((c) => Number(c.outstanding) > 0);

  return (
    <>
      <Figures
        items={[
          { label: 'Customers owe you', value: formatMoney(totals.outstanding, currency) },
          {
            label: 'Of which overdue',
            value: formatMoney(totals.overdue, currency),
            tone: Number(totals.overdue) > 0 ? 'bad' : undefined,
          },
          { label: 'Not yet due', value: formatMoney(totals.notYetDue, currency) },
          { label: 'Customers owing', value: String(owing.length) },
        ]}
      />
      <Panel title="Outstanding by age" meta="due = delivery date + the customer's payment terms">
        <AgingBar receivable={buckets} currency={currency} />
      </Panel>
      <Panel title="By customer">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="align-right">Outstanding</th>
                <th className="align-right">Not yet due</th>
                <th className="align-right">1–30 late</th>
                <th className="align-right">31–60 late</th>
                <th className="align-right">60+ late</th>
                <th className="align-right">Last payment</th>
              </tr>
            </thead>
            <tbody>
              {owing.length === 0 && <EmptyRow colSpan={7}>No customer owes anything right now.</EmptyRow>}
              {owing.map((c) => (
                <tr key={c.customerId}>
                  <td>
                    {c.customerName}
                    <div className="cell-sub">{c.paymentTermsDays === 0 ? 'Pays on delivery' : `${c.paymentTermsDays}-day terms`}</div>
                  </td>
                  <td className="align-right strong">{formatMoney(c.outstanding, currency)}</td>
                  <td className="align-right">{moneyOrDash(c.notYetDue, currency)}</td>
                  <td className="align-right" data-tone={Number(c.overdue1To30) > 0 ? 'attention' : undefined}>
                    {moneyOrDash(c.overdue1To30, currency)}
                  </td>
                  <td className="align-right" data-tone={Number(c.overdue31To60) > 0 ? 'bad' : undefined}>
                    {moneyOrDash(c.overdue31To60, currency)}
                  </td>
                  <td className="align-right" data-tone={Number(c.overdueOver60) > 0 ? 'bad' : undefined}>
                    {moneyOrDash(c.overdueOver60, currency)}
                  </td>
                  <td className="align-right">{formatDateTime(c.lastCollectionAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function moneyOrDash(value: string, currency: string) {
  return Number(value) === 0 ? '—' : formatMoney(value, currency);
}

// ---- Payables ----

function FarmerLots({ farmerId, farmerName, currency, onClose }: { farmerId: string; farmerName: string; currency: string; onClose: () => void }) {
  const { data, error, isPending, refetch } = useUnsettledLots(farmerId);
  const timeZone = useTimeZone();
  return (
    <DetailPanel title={`${farmerName} — unpaid lots`} onClose={onClose}>
      {isPending ? (
        <SkeletonLines lines={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Graded</th>
                <th>Product</th>
                <th className="align-right">Accepted</th>
                <th className="align-right">Rate</th>
                <th className="align-right">Owed</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && <EmptyRow colSpan={5}>Nothing unpaid.</EmptyRow>}
              {data.map((lot) => (
                <tr key={lot.lotId}>
                  <td>{formatDateTime(lot.gradedAt, timeZone)}</td>
                  <td>{lot.productName}</td>
                  <td className="align-right">{formatQuantity(lot.acceptedQuantity)}</td>
                  <td className="align-right">{formatMoney(lot.unitCost, currency)}</td>
                  <td className="align-right strong">{formatMoney(lot.value, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DetailPanel>
  );
}

function Payables() {
  const { data, error, isPending, refetch } = usePayables();
  const [selected, setSelected] = useState<string | null>(null);
  const timeZone = useTimeZone();
  if (isPending) return <Panel title="Farmer payables"><SkeletonLines lines={6} /></Panel>;
  if (error) return <Panel title="Farmer payables"><ErrorState error={error} onRetry={() => refetch()} /></Panel>;

  const { currency, farmers, totals, overdueAfterDays } = data;
  const selectedFarmer = farmers.find((f) => f.farmerId === selected);

  return (
    <>
      <Figures
        items={[
          { label: 'You owe farmers', value: formatMoney(totals.owed, currency) },
          {
            label: `Unpaid over ${overdueAfterDays} days`,
            value: formatMoney(totals.overdue, currency),
            tone: Number(totals.overdue) > 0 ? 'bad' : undefined,
          },
          { label: 'Farmers waiting', value: String(farmers.length) },
        ]}
      />
      <div className="split" data-detail={selectedFarmer ? 'open' : undefined}>
        <Panel title="By farmer" meta="a lot is owed once graded, until it's settled">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Farmer</th>
                  <th className="align-right">Owed</th>
                  <th className="align-right">Overdue</th>
                  <th className="align-right">Lots</th>
                  <th className="align-right">Waiting since</th>
                  <th className="align-right">Last paid</th>
                </tr>
              </thead>
              <tbody>
                {farmers.length === 0 && <EmptyRow colSpan={6}>Every graded lot has been paid for.</EmptyRow>}
                {farmers.map((f) => {
                  const waiting = daysSince(f.oldestUnsettledGradedAt);
                  return (
                    <SelectableRow
                      key={f.farmerId}
                      selected={selected === f.farmerId}
                      onSelect={() => setSelected(f.farmerId)}
                      label={`Unpaid lots for ${f.farmerName}`}
                    >
                      <td>{f.farmerName}</td>
                      <td className="align-right strong">{formatMoney(f.owed, currency)}</td>
                      <td className="align-right" data-tone={Number(f.overdue) > 0 ? 'bad' : undefined}>
                        {moneyOrDash(f.overdue, currency)}
                      </td>
                      <td className="align-right">{f.unsettledLots}</td>
                      <td className="align-right">
                        {waiting === null ? '—' : waiting === 0 ? 'Today' : `${waiting} day${waiting === 1 ? '' : 's'}`}
                      </td>
                      <td className="align-right">{formatDateTime(f.lastSettledAt, timeZone)}</td>
                    </SelectableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        {selectedFarmer && (
          <FarmerLots
            key={selectedFarmer.farmerId}
            farmerId={selectedFarmer.farmerId}
            farmerName={selectedFarmer.farmerName}
            currency={currency}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </>
  );
}

// ---- Cash flow ----

const KIND_LABEL: Record<CashMovementKind, string> = {
  collection: 'From customer',
  settlement: 'To farmer',
  trip_expense: 'Trip expense',
};

// Payment methods and expense categories, as people say them.
const DETAIL_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  fuel: 'Fuel',
  toll: 'Toll',
  labour: 'Labour',
  other: 'Other',
};

function CashFlow() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { data, error, isPending, isPlaceholderData, refetch } = useCashFlow(Number(days));
  const timeZone = useTimeZone();
  const picker = (
    <FilterTabs
      label="Period"
      options={[
        { value: '7', label: '7 days' },
        { value: '30', label: '30 days' },
        { value: '90', label: '90 days' },
      ]}
      value={days}
      onChange={(value) => value !== 'all' && setDays(value)}
    />
  );
  if (isPending) return <Panel title="Cash flow" meta={picker}><SkeletonLines lines={6} /></Panel>;
  if (error) return <Panel title="Cash flow" meta={picker}><ErrorState error={error} onRetry={() => refetch()} /></Panel>;

  const { currency, totals } = data;
  return (
    <div className="stack updating" data-updating={isPlaceholderData || undefined}>
      <Figures
        items={[
          { label: 'Collected from customers', value: formatMoney(totals.cashIn, currency) },
          { label: 'Paid to farmers', value: formatMoney(totals.settlementsOut, currency) },
          { label: 'Trip expenses', value: formatMoney(totals.expensesOut, currency) },
          {
            label: 'Net cash',
            value: formatMoney(totals.net, currency),
            tone: Number(totals.net) < 0 ? 'bad' : undefined,
          },
        ]}
      />
      <Panel title={`${formatDate(data.from)} – ${formatDate(data.to)}`} meta={picker}>
        <CashChart days={data.daily} currency={currency} />
      </Panel>
      <Panel title="Latest movements" meta={`newest ${data.recent.length}`}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Who</th>
                <th>How</th>
                <th className="align-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.length === 0 && <EmptyRow colSpan={5}>No cash moved in this period.</EmptyRow>}
              {data.recent.map((m, i) => (
                <tr key={`${m.referenceId}-${m.kind}-${i}`}>
                  <td>{formatDateTime(m.at, timeZone)}</td>
                  <td>
                    <StatusBadge status={m.kind} tone={m.kind === 'collection' ? 'done' : 'muted'} label={KIND_LABEL[m.kind]} />
                  </td>
                  <td>{m.counterparty}</td>
                  <td>{DETAIL_LABEL[m.detail] ?? m.detail.replace(/_/g, ' ')}</td>
                  <td className="align-right" data-tone={m.kind === 'collection' ? 'good' : undefined}>
                    {m.kind === 'collection' ? '+' : '−'}
                    {formatMoney(m.amount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---- Trip cash ----

function TripCash() {
  const { data, error, isPending, refetch } = useTripCash();
  const timeZone = useTimeZone();
  if (isPending) return <Panel title="Trip cash"><SkeletonLines lines={6} /></Panel>;
  if (error) return <Panel title="Trip cash"><ErrorState error={error} onRetry={() => refetch()} /></Panel>;
  const { currency } = data;
  const shortTrips = data.recent.filter((r) => Number(r.variance) > 0);

  return (
    <>
      <Figures
        items={[
          {
            label: 'Trips waiting for reconciliation',
            value: String(data.awaiting.length),
            tone: data.awaiting.length > 0 ? 'attention' : undefined,
          },
          {
            label: 'Advance still out on them',
            value: formatMoney(sumMoney(data.awaiting.map((t) => t.advanceAmount)), currency),
          },
          {
            label: `Short on last ${data.recent.length} reconciled`,
            value: formatMoney(sumMoney(shortTrips.map((t) => t.variance)), currency),
            tone: shortTrips.length > 0 ? 'bad' : undefined,
          },
        ]}
      />
      <Panel title="Waiting for reconciliation" meta="the driver should hand back advance − expenses">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Finished</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th className="align-right">Advance</th>
                <th className="align-right">Expenses</th>
                <th className="align-right">Expected back</th>
                <th className="align-right">Collected on trip</th>
              </tr>
            </thead>
            <tbody>
              {data.awaiting.length === 0 && <EmptyRow colSpan={7}>Every finished trip has been reconciled.</EmptyRow>}
              {data.awaiting.map((t) => (
                <tr key={t.tripId}>
                  <td>{formatDateTime(t.completedAt, timeZone)}</td>
                  <td>{t.vehicleRegistration}</td>
                  <td>{t.driverName}</td>
                  <td className="align-right">{formatMoney(t.advanceAmount, currency)}</td>
                  <td className="align-right">{formatMoney(t.expenses, currency)}</td>
                  <td className="align-right strong">
                    {formatMoney(sumMoney([t.advanceAmount, `-${t.expenses}`]), currency)}
                  </td>
                  <td className="align-right">{moneyOrDash(t.cashCollected, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Recently reconciled">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reconciled</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th className="align-right">Advance</th>
                <th className="align-right">Expenses</th>
                <th className="align-right">Returned</th>
                <th className="align-right">Variance</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.length === 0 && <EmptyRow colSpan={7}>No trips reconciled yet.</EmptyRow>}
              {data.recent.map((r) => (
                <tr key={r.tripId}>
                  <td>{formatDateTime(r.reconciledAt, timeZone)}</td>
                  <td>{r.vehicleRegistration}</td>
                  <td>{r.driverName}</td>
                  <td className="align-right">{formatMoney(r.advanceAmount, currency)}</td>
                  <td className="align-right">{formatMoney(r.totalExpenses, currency)}</td>
                  <td className="align-right">{formatMoney(r.cashReturned, currency)}</td>
                  <td className="align-right">
                    {Number(r.variance) === 0 ? (
                      <StatusBadge status="balanced" tone="done" label="Balanced" />
                    ) : (
                      <StatusBadge
                        status="variance"
                        tone="bad"
                        label={`${formatMoney(r.variance.replace('-', ''), currency)} ${Number(r.variance) > 0 ? 'short' : 'over'}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ---- Page ----

export default function FinancePage() {
  const { data: session } = useSession();
  const [section, setSection] = useState<Section>('receivables');

  // Deep links from the dashboard's alerts (/finance#payables), including a
  // hash change while this page is already open.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (SECTIONS.some((s) => s.value === hash)) setSection(hash as Section);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const choose = (value: Section) => {
    setSection(value);
    window.history.replaceState(null, '', `#${value}`);
  };

  const header = (
    <PageHeader
      title="Finance"
      subtitle="Who owes you, whom you owe, and where the cash went. Operating figures — not yet the ledger."
    />
  );

  if (session && !hasPermission(session, 'finance:read')) {
    return (
      <div className="stack">
        {header}
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include Finance.</strong>
          <p>Ask the business owner to add finance access to your role if you need it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {header}
      <FilterTabs label="Finance section" options={SECTIONS} value={section} onChange={(v) => v !== 'all' && choose(v)} />
      {section === 'receivables' && <Receivables />}
      {section === 'payables' && <Payables />}
      {section === 'cash' && <CashFlow />}
      {section === 'trips' && <TripCash />}
    </div>
  );
}
