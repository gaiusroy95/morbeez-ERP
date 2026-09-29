'use client';

import { useEffect, useState } from 'react';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader } from '@/components/ui/ListControls';
import { Field } from '@/components/ui/Form';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { HolderPanel, HoldingsTable, type HolderSel, MovementDialog, OverviewView } from '@/components/crates/Holders';
import { CrateSettingsView, LossesView, MovementsView, TripCratesView } from '@/components/crates/Records';
import type { DateRange } from '@/lib/hooks/use-accounting';
import {
  useCrateLosses,
  useCrateMovements,
  useCrateOverview,
  useCrateParties,
  useCrateSettings,
  useCrateTypes,
  useHoldings,
  useTripCrates,
} from '@/lib/hooks/use-crates';
import { useTrips } from '@/lib/hooks/use-modules';
import { formatDate } from '@/lib/format';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';

type Section = 'overview' | 'customers' | 'farmers' | 'vehicles' | 'trips' | 'movements' | 'losses' | 'settings';

const ALL: { value: Section; label: string; needs?: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'customers', label: 'Customers' },
  { value: 'farmers', label: 'Farmers' },
  { value: 'vehicles', label: 'Vehicles' },
  { value: 'trips', label: 'Trips', needs: 'logistics:dispatch' },
  { value: 'movements', label: 'Movements' },
  { value: 'losses', label: 'Losses' },
  { value: 'settings', label: 'Settings' },
];
const HOLDER_OF: Partial<Record<Section, 'customer' | 'farmer' | 'vehicle'>> = { customers: 'customer', farmers: 'farmer', vehicles: 'vehicle' };
const SUBTITLE = 'Where your crates are — with customers, farmers, on vehicles or in the yard — and what was lost.';

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

function Crates({ today, timeZone }: { today: string; timeZone: string }) {
  const { data: session } = useSession();
  const can = (p: string) => hasPermission(session, p);
  const sections = ALL.filter((s) => !s.needs || can(s.needs));
  const currency = useCurrency();

  const [section, setSection] = useState<Section>('overview');
  const [holder, setHolder] = useState<HolderSel | null>(null);
  const [recording, setRecording] = useState(false);
  const [range, setRange] = useState<DateRange>(() => presetRange('month', today));
  const [tripId, setTripId] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (sections.some((s) => s.value === hash)) setSection(hash as Section);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (value: Section) => {
    setSection(value);
    setHolder(null);
    window.history.replaceState(null, '', `#${value}`);
  };
  const open = (h: HolderSel) => {
    const target: Section = h.kind === 'customer' ? 'customers' : h.kind === 'farmer' ? 'farmers' : h.kind === 'vehicle' ? 'vehicles' : 'overview';
    setSection(target);
    window.history.replaceState(null, '', `#${target}`);
    setHolder(h);
  };

  const types = useCrateTypes();
  const overview = useCrateOverview(section === 'overview');
  const holdingKind = HOLDER_OF[section] ?? null;
  const holdings = useHoldings(holdingKind);
  const movements = useCrateMovements(section === 'movements' ? range : null);
  const losses = useCrateLosses(section === 'losses' ? range : null);
  const settings = useCrateSettings(section === 'settings');
  const trips = useTrips(undefined, 1, section === 'trips');
  const parties = useCrateParties();
  const tripCrates = useTripCrates(section === 'trips' ? tripId : null);
  const typeList = types.data ?? [];
  const vehicleName = (id: string) => parties.data?.vehicles.find((v) => v.id === id)?.name ?? '—';

  const panel = holder && (
    <HolderPanel
      key={`${holder.kind}:${holder.id}`}
      sel={holder}
      types={typeList}
      currency={currency}
      today={today}
      timeZone={timeZone}
      canWrite={can('crates:write')}
      canCharge={can('crates:charge')}
      canConfigure={can('crates:configure')}
      onClose={() => setHolder(null)}
    />
  );

  return (
    <div className="stack">
      <PageHeader
        title="Crates"
        subtitle={SUBTITLE}
        actions={
          can('crates:write') &&
          typeList.length > 0 && (
            <button type="button" className="button button-primary" onClick={() => setRecording(true)}>
              Record crates
            </button>
          )
        }
      />
      <FilterTabs label="Crates section" options={sections} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {section === 'overview' && (
        <div className="split" data-detail={holder ? 'open' : undefined}>
          <Loaded title="All crates" query={overview}>
            {(data) => <OverviewView overview={data} onOpen={open} />}
          </Loaded>
          {panel}
        </div>
      )}
      {holdingKind && (
        <div className="split" data-detail={holder ? 'open' : undefined}>
          <Loaded title={`Crates with ${section}`} query={holdings}>
            {(data) => (
              <HoldingsTable
                rows={data}
                kind={holdingKind}
                currency={currency}
                selected={holder?.id ?? null}
                onSelect={(id) => setHolder({ kind: holdingKind, id })}
              />
            )}
          </Loaded>
          {panel}
        </div>
      )}
      {section === 'trips' && (
        <Panel
          title="Crates on a trip"
          meta={
            <Field label="Trip">
              {(p) => (
                <select {...p} value={tripId ?? ''} onChange={(e) => setTripId(e.target.value || null)}>
                  <option value="">Choose a trip…</option>
                  {(trips.data?.items ?? [])
                    .filter((t) => t.status !== 'cancelled')
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {vehicleName(t.vehicleId)} · {t.plannedDate ? formatDate(t.plannedDate) : formatDate(t.createdAt.slice(0, 10))} · {t.status.replace('_', ' ')}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          }
        >
          {!tripId ? (
            <p className="muted">Choose a trip to record the crates loaded, left at each stop, collected, and brought back.</p>
          ) : tripCrates.isPending ? (
            <SkeletonLines lines={6} />
          ) : tripCrates.error || !tripCrates.data ? (
            <ErrorState error={tripCrates.error} onRetry={() => tripCrates.refetch()} />
          ) : (
            <TripCratesView trip={tripCrates.data} types={typeList} today={today} timeZone={timeZone} currency={currency} canWrite={can('crates:write')} />
          )}
        </Panel>
      )}
      {section === 'movements' && (
        <Loaded title="Crate movements" controls={<RangeControls range={range} today={today} onChange={setRange} />} query={movements}>
          {(data) => <MovementsView rows={data} timeZone={timeZone} canWrite={can('crates:write')} />}
        </Loaded>
      )}
      {section === 'losses' && (
        <Loaded title="Lost crates" controls={<RangeControls range={range} today={today} onChange={setRange} />} query={losses}>
          {(data) => <LossesView rows={data} currency={currency} timeZone={timeZone} />}
        </Loaded>
      )}
      {section === 'settings' && (
        <Loaded title="Crate types and alerts" query={settings}>
          {(data) => <CrateSettingsView key={data.version} settings={data} types={typeList} canConfigure={can('crates:configure')} />}
        </Loaded>
      )}
      {recording && <MovementDialog kind="issued" holder={null} types={typeList} today={today} currency={currency} onClose={() => setRecording(false)} />}
    </div>
  );
}

export default function CratesPage() {
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone;
  if (session && !hasPermission(session, 'crates:read')) {
    return (
      <div className="stack">
        <PageHeader title="Crates" subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include crates.</strong>
          <p>Ask the business owner to add crate access to your role if you need it.</p>
        </div>
      </div>
    );
  }
  if (!session || !timeZone) {
    return (
      <div className="stack">
        <PageHeader title="Crates" subtitle={SUBTITLE} />
        <Panel title="Loading">
          <SkeletonLines lines={6} />
        </Panel>
      </div>
    );
  }
  return <Crates today={tenantToday(timeZone)} timeZone={timeZone} />;
}
