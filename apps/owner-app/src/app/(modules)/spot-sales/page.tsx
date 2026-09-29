'use client';

import { useEffect, useState } from 'react';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader, Pager } from '@/components/ui/ListControls';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { BandsView, RecordSaleDialog, SalePanel, SalesTable, SummaryFigures } from '@/components/spot-sales/SpotSales';
import type { DateRange } from '@/lib/hooks/use-accounting';
import { usePriceBands, useSpotSales, useSpotSettings, useSpotSummary } from '@/lib/hooks/use-spot-sales';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';

type Section = 'sales' | 'approvals' | 'bands';
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'approvals', label: 'Awaiting approval' },
  { value: 'bands', label: 'Price bands' },
];
const SUBTITLE = 'What drivers sold from their vehicles to walk-in buyers, and the prices they may charge.';

function tenantToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function SpotSales({ today, timeZone }: { today: string; timeZone: string }) {
  const { data: session } = useSession();
  const can = (p: string) => hasPermission(session, p);
  const currency = useCurrency();
  const [section, setSection] = useState<Section>('sales');
  const [range, setRange] = useState<DateRange>(() => presetRange('month', today));
  const [selected, setSelected] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (SECTIONS.some((s) => s.value === hash)) setSection(hash as Section);
  }, []);
  const choose = (v: Section) => {
    setSection(v);
    setSelected(null);
    setPage(1);
    window.history.replaceState(null, '', `#${v}`);
  };

  const sales = useSpotSales(section === 'sales' ? range : section === 'approvals' ? { from: '2000-01-01', to: today } : null, section === 'approvals' ? 'pending_approval' : null, page);
  const summary = useSpotSummary(section === 'sales' ? range : null);
  const bands = usePriceBands(section === 'bands');
  const settings = useSpotSettings(section === 'bands');

  return (
    <div className="stack">
      <PageHeader
        title="Spot sales"
        subtitle={SUBTITLE}
        actions={
          can('spot_sales:record') &&
          can('logistics:dispatch') && (
            <button type="button" className="button button-primary" onClick={() => setRecording(true)}>
              Record a spot sale
            </button>
          )
        }
      />
      <FilterTabs label="Spot sales section" options={SECTIONS} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {(section === 'sales' || section === 'approvals') && (
        <div className="split" data-detail={selected ? 'open' : undefined}>
          <Panel title={section === 'sales' ? 'Spot sales' : 'Awaiting approval'} meta={section === 'sales' ? <RangeControls range={range} today={today} onChange={(r) => (setRange(r), setPage(1))} /> : undefined}>
            {sales.isPending ? (
              <SkeletonLines lines={8} />
            ) : sales.error || !sales.data ? (
              <ErrorState error={sales.error} onRetry={() => sales.refetch()} />
            ) : (
              <div className="updating" data-updating={sales.isPlaceholderData || undefined}>
                {section === 'sales' && summary.data && <SummaryFigures s={summary.data} />}
                <SalesTable rows={sales.data.items} currency={currency} timeZone={timeZone} selected={selected} onSelect={setSelected} />
                <Pager page={sales.data.page} pageSize={sales.data.pageSize} total={sales.data.total} onPage={setPage} />
              </div>
            )}
          </Panel>
          {selected && <SalePanel key={selected} id={selected} currency={currency} timeZone={timeZone} userEmail={session?.email ?? null} onClose={() => setSelected(null)} />}
        </div>
      )}
      {section === 'bands' && (
        <Panel title="Price bands">
          {bands.isPending || settings.isPending ? (
            <SkeletonLines lines={6} />
          ) : bands.error || settings.error || !bands.data || !settings.data ? (
            <ErrorState error={bands.error ?? settings.error} onRetry={() => (bands.refetch(), settings.refetch())} />
          ) : (
            <BandsView key={settings.data.version} bands={bands.data} settings={settings.data} currency={currency} canConfigure={can('spot_sales:configure')} />
          )}
        </Panel>
      )}
      {recording && (
        <RecordSaleDialog
          currency={currency}
          onClose={() => setRecording(false)}
          onDone={(id) => {
            setRecording(false);
            setSection('sales');
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

export default function SpotSalesPage() {
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone;
  if (session && !hasPermission(session, 'spot_sales:read')) {
    return (
      <div className="stack">
        <PageHeader title="Spot sales" subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include spot sales.</strong>
          <p>Ask the business owner to add spot-sale access to your role if you need it.</p>
        </div>
      </div>
    );
  }
  if (!session || !timeZone) {
    return (
      <div className="stack">
        <PageHeader title="Spot sales" subtitle={SUBTITLE} />
        <Panel title="Loading">
          <SkeletonLines lines={6} />
        </Panel>
      </div>
    );
  }
  return <SpotSales today={tenantToday(timeZone)} timeZone={timeZone} />;
}
