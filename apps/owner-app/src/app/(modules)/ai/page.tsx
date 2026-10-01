'use client';

import { useEffect, useState } from 'react';
import type { AiRecommendationType } from '@morbeez/shared-types';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader, Pager } from '@/components/ui/ListControls';
import { presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { SuggestionCard, TYPE_LABEL } from '@/components/ai/Suggestions';
import { AiSettingsView, PinsView, ProfitView, ScorecardView } from '@/components/ai/Reports';
import type { DateRange } from '@/lib/hooks/use-accounting';
import { useAiSettings, useCustomerProfit, useLastRun, usePins, useScorecard, useSuggestions } from '@/lib/hooks/use-ai';
import { apiSend } from '@/lib/api/client';
import { KEYS, useAction } from '@/lib/hooks/use-action';
import { formatDateTime } from '@/lib/format';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';
import { displayLogin } from '@/lib/phone';

type Section = 'open' | 'decided' | 'profit' | 'record' | 'settings';
const SECTIONS: { value: Section; label: string; needs?: string }[] = [
  { value: 'open', label: 'To decide' },
  { value: 'decided', label: 'Decided' },
  { value: 'profit', label: 'Customer profitability', needs: 'finance:read' },
  { value: 'record', label: 'Track record' },
  { value: 'settings', label: 'Settings' },
];
const TYPE_FILTER: { value: AiRecommendationType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(['procurement', 'pricing', 'logistics_route', 'logistics_load', 'customer_terms', 'exception'] as AiRecommendationType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] })),
];
const SUBTITLE = 'What the numbers suggest. You decide — nothing here changes anything until you act on it.';

function tenantToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function Loaded<T>({ title, controls, query, children }: { title: string; controls?: React.ReactNode; query: { data: T | undefined; error: unknown; isPending: boolean; isPlaceholderData?: boolean; refetch: () => unknown }; children: (d: T) => React.ReactNode }) {
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

function Suggestions({ today, timeZone }: { today: string; timeZone: string }) {
  const { data: session } = useSession();
  const permissions = session?.permissions ?? [];
  const can = (p: string) => hasPermission(session, p);
  const currency = useCurrency();
  const sections = SECTIONS.filter((s) => !s.needs || can(s.needs));
  const [section, setSection] = useState<Section>('open');
  const [type, setType] = useState<AiRecommendationType | 'all'>('all');
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<DateRange>(() => presetRange('last_month', today));

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (sections.some((s) => s.value === hash)) setSection(hash as Section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (v: Section) => {
    setSection(v);
    setPage(1);
    window.history.replaceState(null, '', `#${v}`);
  };

  const list = useSuggestions(section === 'decided' ? 'decided' : 'open', type === 'all' ? null : type, page, section === 'open' || section === 'decided');
  const lastRun = useLastRun();
  const card = useScorecard(section === 'record');
  const profit = useCustomerProfit(section === 'profit' ? range : null);
  const settings = useAiSettings(section === 'settings');
  const pins = usePins(section === 'settings' && can('logistics:dispatch'));
  const refresh = useAction(() => apiSend('POST', 'ai/runs', {}), [KEYS.ai]);
  const run = lastRun.data;
  const suppressed = run ? Object.entries(run.suppressed) : [];

  return (
    <div className="stack">
      <PageHeader
        title="Suggestions"
        subtitle={SUBTITLE}
        actions={
          <button type="button" className="button button-primary" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}>
            {refresh.isPending ? 'Working it out…' : 'Get fresh suggestions'}
          </button>
        }
      />
      <FilterTabs label="Suggestions section" options={sections} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {(section === 'open' || section === 'decided') && (
        <Loaded
          title={section === 'open' ? 'To decide' : 'Decided'}
          controls={<FilterTabs label="Suggestion type" options={TYPE_FILTER} value={type} onChange={(t) => (setType(t), setPage(1))} />}
          query={list}
        >
          {({ items: rows, page: shown, pageSize, total }) => (
            <>
              {section === 'open' && (
                <p className="muted run-note" role="status">
                  {refresh.error ? `Couldn't compute: ${(refresh.error as Error).message}. ` : ''}
                  {run ? `Last worked out ${formatDateTime(run.finishedAt, timeZone)}${run.byEmail ? ` by ${displayLogin(run.byEmail)}` : ''}.` : 'No suggestions worked out yet.'}
                  {suppressed.length > 0 && ` Not suggested: ${suppressed.map(([t, why]) => `${TYPE_LABEL[t as AiRecommendationType] ?? t} (${why})`).join('; ')}.`}
                </p>
              )}
              {rows.length === 0 ? (
                <p className="muted">{section === 'open' ? 'Nothing to decide right now.' : 'Nothing decided yet.'}</p>
              ) : (
                <div className="suggestions">
                  {rows.map((r) => (
                    <SuggestionCard key={r.id} rec={r} currency={currency} timeZone={timeZone} permissions={permissions} />
                  ))}
                </div>
              )}
              <Pager page={shown} pageSize={pageSize} total={total} onPage={setPage} />
            </>
          )}
        </Loaded>
      )}
      {section === 'profit' && (
        <Loaded title="What each customer contributes" controls={<RangeControls range={range} today={today} onChange={setRange} />} query={profit}>
          {(r) => <ProfitView report={r} />}
        </Loaded>
      )}
      {section === 'record' && (
        <Loaded title="How good the suggestions have been" query={card}>
          {(c) => <ScorecardView card={c} />}
        </Loaded>
      )}
      {section === 'settings' && (
        <>
          <Loaded title="How suggestions are worked out" query={settings}>
            {(s) => <AiSettingsView key={s.version} settings={s} canConfigure={can('ai:configure')} />}
          </Loaded>
          {can('logistics:dispatch') && (
            <Loaded title="Map pins for routes" query={pins}>
              {(p) => <PinsView pins={p} canEdit={can('logistics:dispatch')} />}
            </Loaded>
          )}
        </>
      )}
    </div>
  );
}

export default function AiPage() {
  const { data: session } = useSession();
  const timeZone = useTenantProfile().data?.timezone;
  if (session && !hasPermission(session, 'ai:read')) {
    return (
      <div className="stack">
        <PageHeader title="Suggestions" subtitle={SUBTITLE} />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include suggestions.</strong>
          <p>Ask the business owner to add them to your role if you need them.</p>
        </div>
      </div>
    );
  }
  if (!session || !timeZone) {
    return (
      <div className="stack">
        <PageHeader title="Suggestions" subtitle={SUBTITLE} />
        <Panel title="Loading">
          <SkeletonLines lines={6} />
        </Panel>
      </div>
    );
  }
  return <Suggestions today={tenantToday(timeZone)} timeZone={timeZone} />;
}
