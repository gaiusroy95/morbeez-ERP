'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader } from '@/components/ui/ListControls';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { AddWorkerDialog, WorkerPanel, WorkersTable } from '@/components/workforce/Workers';
import { AssignmentsView } from '@/components/workforce/Assignments';
import { AdvancesView, PayRunView, SettlementPanel, SettlementsView } from '@/components/workforce/Pay';
import { IncentiveRulesView, MinimumWagesView, PayrollSettingsView } from '@/components/workforce/Rules';
import type { DateRange } from '@/lib/hooks/use-accounting';
import {
  useAdvances,
  useAssignments,
  useEarnings,
  useIncentiveRules,
  useMinimumWages,
  usePayrollSettings,
  useSettlements,
  useWorkers,
} from '@/lib/hooks/use-workforce';
import { apiGet } from '@/lib/api/client';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';

type Section = 'workers' | 'assignments' | 'payrun' | 'settlements' | 'advances' | 'rules';

const ALL: { value: Section; label: string; needs: string }[] = [
  { value: 'workers', label: 'Workers', needs: 'workforce:read' },
  { value: 'assignments', label: 'Work & attendance', needs: 'workforce:read' },
  { value: 'payrun', label: 'Pay run', needs: 'payroll:read' },
  { value: 'settlements', label: 'Settlements', needs: 'payroll:read' },
  { value: 'advances', label: 'Advances', needs: 'payroll:read' },
  { value: 'rules', label: 'Wage rules', needs: 'payroll:read' },
];

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

function Workforce({ today, timeZone }: { today: string; timeZone: string }) {
  const { data: session } = useSession();
  const can = (p: string) => hasPermission(session, p);
  const sections = ALL.filter((s) => can(s.needs));
  const currency = useCurrency();

  const [section, setSection] = useState<Section>(sections[0]?.value ?? 'workers');
  const [workRange, setWorkRange] = useState<DateRange>(() => ({ from: presetRange('month', today).from, to: today }));
  const [payRange, setPayRange] = useState<DateRange>(() => presetRange('last_month', today));
  const [worker, setWorker] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [adding, setAdding] = useState(false);

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
    window.history.replaceState(null, '', `#${value}`);
  };

  const states = useQuery({
    queryKey: ['workforce', 'states'],
    queryFn: () => apiGet<{ code: string; name: string }[]>('workforce/states'),
    staleTime: Infinity,
  });
  const workers = useWorkers();
  const assignments = useAssignments(section === 'assignments' ? workRange : null);
  const earnings = useEarnings(section === 'payrun' ? payRange : null);
  const settlements = useSettlements(status === 'all' ? null : status, section === 'settlements');
  const advances = useAdvances(section === 'advances');
  const incentives = useIncentiveRules(section === 'rules');
  const minimumWages = useMinimumWages(section === 'rules');
  const settings = usePayrollSettings(section === 'rules');
  const stateList = states.data ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Workforce"
        subtitle="Who works for you, what they did, and what they're paid."
        actions={
          can('workforce:write') &&
          section === 'workers' && (
            <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
              Add a worker
            </button>
          )
        }
      />
      <FilterTabs label="Workforce section" options={sections} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {section === 'workers' && (
        <div className="split" data-detail={worker ? 'open' : undefined}>
          <Loaded title="Workers" query={workers}>
            {(data) => <WorkersTable workers={data} currency={currency} selected={worker} onSelect={setWorker} />}
          </Loaded>
          {worker && (
            <WorkerPanel
              key={worker}
              id={worker}
              currency={currency}
              states={stateList}
              canWrite={can('workforce:write')}
              canConfigure={can('payroll:configure')}
              onClose={() => setWorker(null)}
            />
          )}
        </div>
      )}
      {section === 'assignments' && (
        <Loaded title="Work and attendance" controls={<RangeControls range={workRange} today={today} onChange={setWorkRange} />} query={assignments}>
          {(data) => <AssignmentsView rows={data} workers={workers.data ?? []} today={today} canWrite={can('workforce:write')} />}
        </Loaded>
      )}
      {section === 'payrun' && (
        <Loaded title="Pay run" controls={<RangeControls range={payRange} today={today} onChange={setPayRange} />} query={earnings}>
          {(data) => (
            <PayRunView
              key={`${payRange.from}:${payRange.to}`}
              rows={data}
              range={payRange}
              currency={currency}
              canPrepare={can('payroll:prepare')}
              onDrafted={() => {
                setStatus('draft');
                choose('settlements');
              }}
            />
          )}
        </Loaded>
      )}
      {section === 'settlements' && (
        <div className="split" data-detail={settlement ? 'open' : undefined}>
          <Loaded title="Settlements" query={settlements}>
            {(data) => <SettlementsView rows={data} status={status} onStatus={setStatus} currency={currency} selected={settlement} onSelect={setSettlement} />}
          </Loaded>
          {settlement && (
            <SettlementPanel
              key={settlement}
              id={settlement}
              currency={currency}
              timeZone={timeZone}
              userEmail={session?.login ?? null}
              canApprove={can('payroll:approve')}
              canPay={can('payroll:pay')}
              onClose={() => setSettlement(null)}
            />
          )}
        </div>
      )}
      {section === 'advances' && (
        <Loaded title="Advances" query={advances}>
          {(data) => <AdvancesView rows={data} workers={workers.data ?? []} currency={currency} today={today} canPrepare={can('payroll:prepare')} />}
        </Loaded>
      )}
      {section === 'rules' && (
        <>
          <Loaded title="Payroll settings" query={settings}>
            {(data) => <PayrollSettingsView key={data.version} settings={data} states={stateList} canConfigure={can('payroll:configure')} />}
          </Loaded>
          <Loaded title="Minimum wages" query={minimumWages}>
            {(data) => <MinimumWagesView rows={data} states={stateList} today={today} currency={currency} canConfigure={can('payroll:configure')} />}
          </Loaded>
          <Loaded title="Incentives" query={incentives}>
            {(data) => <IncentiveRulesView rows={data} today={today} currency={currency} canConfigure={can('payroll:configure')} />}
          </Loaded>
        </>
      )}
      {adding && (
        <AddWorkerDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setWorker(id);
          }}
        />
      )}
    </div>
  );
}

export default function WorkforcePage() {
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone;
  if (session && !hasPermission(session, 'workforce:read')) {
    return (
      <div className="stack">
        <PageHeader title="Workforce" subtitle="Who works for you, what they did, and what they're paid." />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include the workforce.</strong>
          <p>Ask the business owner to add workforce access to your role if you need it.</p>
        </div>
      </div>
    );
  }
  if (!session || !timeZone) {
    return (
      <div className="stack">
        <PageHeader title="Workforce" subtitle="Who works for you, what they did, and what they're paid." />
        <Panel title="Loading">
          <SkeletonLines lines={6} />
        </Panel>
      </div>
    );
  }
  return <Workforce today={tenantToday(timeZone)} timeZone={timeZone} />;
}
