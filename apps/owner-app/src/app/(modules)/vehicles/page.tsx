'use client';

import { useEffect, useState } from 'react';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader } from '@/components/ui/ListControls';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { AddVehicleDialog, VehiclePanel, VehiclesTable } from '@/components/fleet/Vehicles';
import { AssetsView, EconomicsView, FleetSettingsView, FuelLogView, HireBillsView, LoansView } from '@/components/fleet/Books';
import type { DateRange } from '@/lib/hooks/use-accounting';
import { useAssets, useEconomics, useFleet, useFleetSettings, useFuelLog, useHireBills, useLoans } from '@/lib/hooks/use-fleet';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';

type Section = 'fleet' | 'fuel' | 'assets' | 'loans' | 'hire' | 'costs' | 'settings';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'fleet', label: 'Fleet' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'assets', label: 'Assets & depreciation' },
  { value: 'loans', label: 'Loans' },
  { value: 'hire', label: 'Hired vehicles' },
  { value: 'costs', label: 'Cost report' },
  { value: 'settings', label: 'Settings' },
];

const SUBTITLE = 'Your fleet, whether each vehicle is fit for the road, and what it costs to run.';

function tenantToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function Loaded<T>({
  title,
  controls,
  query,
  children,
}: {
  title: string;
  controls?: React.ReactNode;
  query: { data: T | undefined; error: unknown; isPending: boolean; isPlaceholderData?: boolean; refetch: () => unknown };
  children: (data: T) => React.ReactNode;
}) {
  return (
    <Panel title={title} meta={controls}>
      {query.isPending ? (
        <SkeletonLines lines={8} />
      ) : query.error || query.data === undefined ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="updating" data-updating={query.isPlaceholderData || undefined}>
          {children(query.data)}
        </div>
      )}
    </Panel>
  );
}

function Vehicles({ today }: { today: string }) {
  const { data: session } = useSession();
  const can = (p: string) => hasPermission(session, p);
  const currency = useCurrency();

  const [section, setSection] = useState<Section>('fleet');
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [fuelRange, setFuelRange] = useState<DateRange>(() => presetRange('month', today));
  const [costRange, setCostRange] = useState<DateRange>(() => presetRange('last_month', today));
  const [billStatus, setBillStatus] = useState('unpaid');

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

  const fleet = useFleet();
  const fuel = useFuelLog(section === 'fuel' ? fuelRange : null);
  const assets = useAssets(section === 'assets');
  const loans = useLoans(section === 'loans');
  const bills = useHireBills(billStatus === 'all' ? null : billStatus, section === 'hire');
  const economics = useEconomics(section === 'costs' ? costRange : null);
  const settings = useFleetSettings(section === 'settings');

  return (
    <div className="stack">
      <PageHeader
        title="Vehicles"
        subtitle={SUBTITLE}
        actions={
          can('vehicles:write') &&
          section === 'fleet' && (
            <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
              Add a vehicle
            </button>
          )
        }
      />
      <FilterTabs label="Vehicles section" options={SECTIONS} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {section === 'fleet' && (
        <div className="split" data-detail={vehicle ? 'open' : undefined}>
          <Loaded title="Fleet" query={fleet}>
            {(data) => <VehiclesTable vehicles={data} currency={currency} selected={vehicle} onSelect={setVehicle} />}
          </Loaded>
          {vehicle && (
            <VehiclePanel
              key={vehicle}
              id={vehicle}
              currency={currency}
              today={today}
              canWrite={can('vehicles:write')}
              canFinance={can('fleet:finance')}
              onClose={() => setVehicle(null)}
            />
          )}
        </div>
      )}
      {section === 'fuel' && (
        <Loaded title="Fuel log" controls={<RangeControls range={fuelRange} today={today} onChange={setFuelRange} />} query={fuel}>
          {(data) => <FuelLogView rows={data} vehicles={fleet.data ?? []} currency={currency} />}
        </Loaded>
      )}
      {section === 'assets' && (
        <Loaded title="Assets and depreciation" query={assets}>
          {(data) => <AssetsView rows={data} currency={currency} today={today} canFinance={can('fleet:finance')} />}
        </Loaded>
      )}
      {section === 'loans' && (
        <Loaded title="Vehicle loans" query={loans}>
          {(data) => <LoansView rows={data} currency={currency} today={today} canFinance={can('fleet:finance')} />}
        </Loaded>
      )}
      {section === 'hire' && (
        <Loaded title="Hire bills" query={bills}>
          {(data) => <HireBillsView rows={data} status={billStatus} onStatus={setBillStatus} currency={currency} today={today} canFinance={can('fleet:finance')} />}
        </Loaded>
      )}
      {section === 'costs' && (
        <Loaded title="What each vehicle cost" controls={<RangeControls range={costRange} today={today} onChange={setCostRange} />} query={economics}>
          {(data) => <EconomicsView report={data} />}
        </Loaded>
      )}
      {section === 'settings' && (
        <Loaded title="Fleet settings" query={settings}>
          {(data) => <FleetSettingsView key={data.version} settings={data} canWrite={can('vehicles:write')} />}
        </Loaded>
      )}
      {adding && (
        <AddVehicleDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setVehicle(id);
          }}
        />
      )}
    </div>
  );
}

export default function VehiclesPage() {
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone;
  if (session && !hasPermission(session, 'vehicles:read')) {
    return (
      <div className="stack">
        <PageHeader title="Vehicles" subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include vehicles.</strong>
          <p>Ask the business owner to add vehicle access to your role if you need it.</p>
        </div>
      </div>
    );
  }
  if (!session || !timeZone) {
    return (
      <div className="stack">
        <PageHeader title="Vehicles" subtitle={SUBTITLE} />
        <Panel title="Loading">
          <SkeletonLines lines={6} />
        </Panel>
      </div>
    );
  }
  return <Vehicles today={tenantToday(timeZone)} />;
}
