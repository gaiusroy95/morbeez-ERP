'use client';

import { useEffect, useState } from 'react';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader } from '@/components/ui/ListControls';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { GstRatesView, ProfileView, REGISTRATION_LABEL, TdsSectionsView } from '@/components/tax/Settings';
import { CustomersTaxView, FarmersTaxView, ProductsTaxView } from '@/components/tax/Parties';
import { Gstr1View, Gstr3bView, InvoicesView } from '@/components/tax/Gst';
import { TdsView } from '@/components/tax/Tds';
import type { DateRange } from '@/lib/hooks/use-accounting';
import { useAccounts } from '@/lib/hooks/use-accounting';
import {
  useCustomerTax,
  useFarmerTax,
  useGstr1,
  useGstr3b,
  useGstRates,
  useProductTax,
  useTaxInvoices,
  useTaxProfile,
  useTaxReference,
  useTdsRegister,
  useTdsSections,
} from '@/lib/hooks/use-tax';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';

type Section = 'settings' | 'hsn' | 'customers' | 'farmers' | 'invoices' | 'gstr1' | 'gstr3b' | 'tds';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'invoices', label: 'GST invoices' },
  { value: 'gstr1', label: 'GSTR-1' },
  { value: 'gstr3b', label: 'GSTR-3B' },
  { value: 'tds', label: 'TDS' },
  { value: 'hsn', label: 'Products & HSN' },
  { value: 'customers', label: 'Customer GSTINs' },
  { value: 'farmers', label: 'Farmer PANs' },
  { value: 'settings', label: 'Settings & rates' },
];

/** Today in the tenant's timezone — the date the server itself uses for tax. */
function tenantToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function fyOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function quarterOf(date: string): 1 | 2 | 3 | 4 {
  const m = Number(date.slice(5, 7));
  return m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
}

/** Data panel shell: skeleton, error with retry, dimmed while reloading. */
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

function TaxBooks({ today, timeZone }: { today: string; timeZone: string }) {
  const { data: session } = useSession();
  const canConfigure = hasPermission(session, 'tax:configure');
  const canFile = hasPermission(session, 'tax:file');
  const canReadBooks = hasPermission(session, 'accounting:read');
  const currency = useCurrency();

  const [section, setSection] = useState<Section>('invoices');
  const [range, setRange] = useState<DateRange>(() => presetRange('month', today));
  const [fy, setFy] = useState(() => fyOf(today));
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(() => quarterOf(today));

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

  const reference = useTaxReference();
  const profile = useTaxProfile();
  // Each read runs only while its section is open (TDS sections also feed
  // the settings form and the TDS dialog).
  const rates = useGstRates(section === 'settings');
  const sections = useTdsSections(section === 'settings' || section === 'tds');
  const products = useProductTax(section === 'hsn');
  const customers = useCustomerTax(section === 'customers');
  const farmers = useFarmerTax(section === 'farmers');
  const invoices = useTaxInvoices(section === 'invoices' ? range : null);
  const gstr1 = useGstr1(section === 'gstr1' ? range : null);
  const gstr3b = useGstr3b(section === 'gstr3b' ? range : null);
  const tds = useTdsRegister(fy, quarter, section === 'tds');
  const accounts = useAccounts(false, section === 'tds' && canReadBooks);

  if (!reference.data || !profile.data) {
    return (
      <Panel title="Loading">
        {reference.error || profile.error ? (
          <ErrorState error={reference.error ?? profile.error} onRetry={() => (reference.refetch(), profile.refetch())} />
        ) : (
          <SkeletonLines lines={6} />
        )}
      </Panel>
    );
  }
  const ref = reference.data;
  const p = profile.data;
  const rangeControls = <RangeControls range={range} today={today} onChange={setRange} />;
  const years = [fyOf(today), fyOf(`${Number(today.slice(0, 4)) - 1}${today.slice(4)}`)];
  const quarterControls = (
    <div className="range-controls">
      <label htmlFor="tds-fy">Year</label>
      <select id="tds-fy" value={fy} onChange={(e) => setFy(e.target.value)}>
        {years.map((y) => (
          <option key={y} value={y}>
            FY {y}
          </option>
        ))}
      </select>
      <label htmlFor="tds-q">Quarter</label>
      <select id="tds-q" value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}>
        <option value={1}>Q1 Apr–Jun</option>
        <option value={2}>Q2 Jul–Sep</option>
        <option value={3}>Q3 Oct–Dec</option>
        <option value={4}>Q4 Jan–Mar</option>
      </select>
    </div>
  );

  return (
    <div className="stack">
      <PageHeader
        title="Tax"
        subtitle={`GST, HSN, TDS and e-invoicing · ${REGISTRATION_LABEL[p.registrationType]}${p.gstin ? ` · ${p.gstin}` : ''}`}
      />
      <FilterTabs label="Tax section" options={SECTIONS} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {section === 'invoices' && (
        <Loaded title="GST invoice register" controls={rangeControls} query={invoices}>
          {(data) => <InvoicesView rows={data} reference={ref} currency={currency} timeZone={timeZone} canFile={canFile} />}
        </Loaded>
      )}
      {section === 'gstr1' && (
        <Loaded title="GSTR-1 — outward supplies" controls={rangeControls} query={gstr1}>
          {(data) => <Gstr1View data={data} reference={ref} />}
        </Loaded>
      )}
      {section === 'gstr3b' && (
        <Loaded title="GSTR-3B — summary" controls={rangeControls} query={gstr3b}>
          {(data) => <Gstr3bView data={data} reference={ref} />}
        </Loaded>
      )}
      {section === 'tds' && (
        <Loaded title="TDS register" controls={quarterControls} query={tds}>
          {(data) => (
            <TdsView
              register={data}
              sections={sections.data ?? []}
              expenseAccounts={canReadBooks ? accounts.data ?? [] : null}
              today={today}
              canFile={canFile}
            />
          )}
        </Loaded>
      )}
      {section === 'hsn' && (
        <Loaded title="Products and HSN codes" query={products}>
          {(data) => <ProductsTaxView rows={data} minDigits={p.hsnMinDigits} canConfigure={canConfigure} />}
        </Loaded>
      )}
      {section === 'customers' && (
        <Loaded title="Customer GSTINs and place of supply" query={customers}>
          {(data) => <CustomersTaxView rows={data} reference={ref} canConfigure={canConfigure} />}
        </Loaded>
      )}
      {section === 'farmers' && (
        <Loaded title="Farmer PANs and TDS" query={farmers}>
          {(data) => <FarmersTaxView rows={data} currency={currency} section={p.farmerTdsSection} canConfigure={canConfigure} />}
        </Loaded>
      )}
      {section === 'settings' && (
        <>
          <Panel title="Registration">
            <ProfileView profile={p} reference={ref} sections={sections.data ?? []} canConfigure={canConfigure} />
          </Panel>
          <Loaded title="GST rates by HSN / SAC" query={rates}>
            {(data) => <GstRatesView rates={data} canConfigure={canConfigure} />}
          </Loaded>
          <Loaded title="TDS sections" query={sections}>
            {(data) => <TdsSectionsView sections={data} canConfigure={canConfigure} />}
          </Loaded>
        </>
      )}
    </div>
  );
}

export default function TaxPage() {
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone;
  if (session && !hasPermission(session, 'tax:read')) {
    return (
      <div className="stack">
        <PageHeader title="Tax" subtitle="GST, HSN, TDS and e-invoicing." />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include tax.</strong>
          <p>Ask the business owner to add tax access to your role if you need it.</p>
        </div>
      </div>
    );
  }
  if (!session || !timeZone) {
    return (
      <div className="stack">
        <PageHeader title="Tax" subtitle="GST, HSN, TDS and e-invoicing." />
        <Panel title="Loading">
          <SkeletonLines lines={6} />
        </Panel>
      </div>
    );
  }
  return <TaxBooks today={tenantToday(timeZone)} timeZone={timeZone} />;
}
