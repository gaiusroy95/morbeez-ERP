'use client';

import { useState } from 'react';
import { ErrorState, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader, Pager } from '@/components/ui/ListControls';
import { SuggestionCard } from '@/components/ai/Suggestions';
import { FreshButton, RunNote } from '@/components/ai/RunBar';
import { useOpenSuggestions, useSuggestions } from '@/lib/hooks/use-ai';
import { useCurrency, useTenantProfile } from '@/lib/hooks/use-lookups';
import { useSession } from '@/lib/hooks/use-tenant';
import { useT } from '@/lib/i18n';

type Tab = 'expected' | 'check' | 'decided';

/**
 * AI Orders (owner Phase 8; first mockup set, screen 16; requirements Part 14
 * and 23): customers whose usual order for tomorrow hasn't come — place it
 * when they've told you, or ask them — and orders far from what a customer
 * usually takes, to confirm with them. The suggestion never places or changes
 * an order; you do, on the ordinary order (AI System DR.3).
 */
export default function AiOrdersPage() {
  const t = useT();
  const { data: session } = useSession();
  const currency = useCurrency();
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';
  const [tab, setTab] = useState<Tab>('expected');
  const [page, setPage] = useState(1);
  const open = useOpenSuggestions('order');
  const decided = useSuggestions('decided', 'order', page, tab === 'decided');
  const items = open.data?.items ?? [];
  const expected = items.filter((r) => r.proposal.action === 'delivery_order');
  const check = items.filter((r) => r.proposal.action === 'confirm_order');
  const shown = tab === 'expected' ? expected : check;
  const permissions = session?.permissions ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="AI Orders"
        subtitle="Customers' usual orders that haven't come yet, and orders far from what a customer usually takes. You place or confirm — nothing changes until you do."
        actions={<FreshButton />}
      />
      <FilterTabs
        label={t('AI orders')}
        options={[
          { value: 'expected', label: `${t('Expected')} (${expected.length})` },
          { value: 'check', label: `${t('Check quantity')} (${check.length})` },
          { value: 'decided', label: t('Decided') },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          setPage(1);
        }}
      />
      <RunNote type="order" />
      {tab === 'decided' ? (
        decided.isPending ? (
          <SkeletonLines lines={6} />
        ) : decided.error || !decided.data ? (
          <ErrorState error={decided.error} onRetry={() => decided.refetch()} />
        ) : decided.data.items.length === 0 ? (
          <p className="muted">{t('Nothing decided yet.')}</p>
        ) : (
          <>
            <div className="suggestions">
              {decided.data.items.map((r) => (
                <SuggestionCard key={r.id} rec={r} currency={currency} timeZone={timeZone} permissions={permissions} />
              ))}
            </div>
            <Pager page={decided.data.page} pageSize={decided.data.pageSize} total={decided.data.total} onPage={setPage} />
          </>
        )
      ) : open.isPending ? (
        <SkeletonLines lines={6} />
      ) : open.error ? (
        <ErrorState error={open.error} onRetry={() => open.refetch()} />
      ) : shown.length === 0 ? (
        <p className="muted">
          {t(tab === 'expected' ? 'No customer is expected to order who hasn’t yet.' : 'No order is far from what its customer usually takes.')}
        </p>
      ) : (
        <div className="suggestions">
          {shown.map((r) => (
            <SuggestionCard key={r.id} rec={r} currency={currency} timeZone={timeZone} permissions={permissions} />
          ))}
        </div>
      )}
    </div>
  );
}
