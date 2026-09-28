'use client';

import { useEffect, useState } from 'react';
import { ErrorState, Panel, SkeletonLines } from '@/components/ui/Panel';
import { FilterTabs, PageHeader } from '@/components/ui/ListControls';
import { AsOfControl, presetRange, RangeControls } from '@/components/accounting/RangeControls';
import { BalanceSheetView, CashFlowView, ProfitAndLossView } from '@/components/accounting/Statements';
import { AccountPicker, GeneralLedgerView, TrialBalanceView } from '@/components/accounting/Ledgers';
import { JournalsTable, NewJournalDialog } from '@/components/accounting/Journals';
import { AccountDialog, ChartOfAccountsTable } from '@/components/accounting/ChartOfAccounts';
import { PeriodsView } from '@/components/accounting/Periods';
import {
  type DateRange,
  useAccounts,
  useBalanceSheet,
  useCashFlowStatement,
  useGeneralLedger,
  useJournalEntries,
  usePeriods,
  useProfitAndLoss,
  useTrialBalance,
} from '@/lib/hooks/use-accounting';
import { useTenantProfile } from '@/lib/hooks/use-lookups';
import { hasPermission, useSession } from '@/lib/hooks/use-tenant';

type Section = 'pnl' | 'balance-sheet' | 'cash-flow' | 'trial-balance' | 'ledger' | 'journals' | 'accounts' | 'periods';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'pnl', label: 'Profit & loss' },
  { value: 'balance-sheet', label: 'Balance sheet' },
  { value: 'cash-flow', label: 'Cash flow' },
  { value: 'trial-balance', label: 'Trial balance' },
  { value: 'ledger', label: 'General ledger' },
  { value: 'journals', label: 'Journals' },
  { value: 'accounts', label: 'Chart of accounts' },
  { value: 'periods', label: 'Period closing' },
];

/** Data panel shell: skeleton while loading, error with retry, dimmed while a new range loads. */
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

function PrintButton() {
  return (
    <button type="button" className="button button-small no-print" onClick={() => window.print()}>
      Print
    </button>
  );
}

function Books({ today, lockedThrough }: { today: string; lockedThrough: string | null }) {
  const { data: session } = useSession();
  const canPost = hasPermission(session, 'accounting:post');
  const canManage = hasPermission(session, 'accounting:manage');
  const canClose = hasPermission(session, 'accounting:close');
  const timeZone = useTenantProfile().data?.timezone ?? 'Asia/Kolkata';

  const [section, setSection] = useState<Section>('pnl');
  const [range, setRange] = useState<DateRange>(() => presetRange('month', today));
  const [asOf, setAsOf] = useState(today);
  const [ledgerCode, setLedgerCode] = useState<string | null>(null);
  const [manualOnly, setManualOnly] = useState(false);
  const [journalPage, setJournalPage] = useState(1);
  const [dialog, setDialog] = useState<'journal' | 'account' | null>(null);

  // Deep links (/accounting#balance-sheet), including a hash change while open.
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

  // From a period statement: the same dates. From an as-of statement: the
  // financial year up to that date.
  const openLedger = (code: string, from: 'range' | 'asOf') => {
    setLedgerCode(code);
    if (from === 'asOf') setRange({ from: presetRange('fy', asOf).from, to: asOf });
    choose('ledger');
  };

  const accounts = useAccounts(section === 'accounts');
  const pnl = useProfitAndLoss(section === 'pnl' ? range : null);
  const sheet = useBalanceSheet(section === 'balance-sheet' ? asOf : null);
  const cash = useCashFlowStatement(section === 'cash-flow' ? range : null);
  const tb = useTrialBalance(section === 'trial-balance' ? asOf : null);
  const ledger = useGeneralLedger(section === 'ledger' ? ledgerCode : null, range);
  const journals = useJournalEntries(section === 'journals' ? range : null, manualOnly, journalPage);
  const periods = usePeriods();

  const rangeControls = <RangeControls range={range} today={today} onChange={(r) => { setRange(r); setJournalPage(1); }} />;
  const asOfControl = <AsOfControl asOf={asOf} today={today} onChange={setAsOf} />;

  return (
    <div className="stack">
      <PageHeader
        title="Accounting"
        subtitle="The books: statements, ledger, journals, and closing — all from one double-entry ledger."
        actions={
          <div className="action-bar" style={{ marginTop: 0 }}>
            {canPost && (
              <button type="button" className="button button-primary" onClick={() => setDialog('journal')}>
                New journal
              </button>
            )}
            {canManage && section === 'accounts' && (
              <button type="button" className="button" onClick={() => setDialog('account')}>
                New account
              </button>
            )}
          </div>
        }
      />
      <FilterTabs label="Accounting section" options={SECTIONS} value={section} onChange={(v) => v !== 'all' && choose(v)} />

      {section === 'pnl' && (
        <Loaded title="Profit and loss" controls={<>{rangeControls}<PrintButton /></>} query={pnl}>
          {(data) => <ProfitAndLossView pnl={data} onOpen={(code) => openLedger(code, 'range')} />}
        </Loaded>
      )}
      {section === 'balance-sheet' && (
        <Loaded title="Balance sheet" controls={<>{asOfControl}<PrintButton /></>} query={sheet}>
          {(data) => <BalanceSheetView sheet={data} onOpen={(code) => openLedger(code, 'asOf')} />}
        </Loaded>
      )}
      {section === 'cash-flow' && (
        <Loaded title="Cash flow" controls={<>{rangeControls}<PrintButton /></>} query={cash}>
          {(data) => <CashFlowView flow={data} onOpen={(code) => openLedger(code, 'range')} />}
        </Loaded>
      )}
      {section === 'trial-balance' && (
        <Loaded title="Trial balance" controls={<>{asOfControl}<PrintButton /></>} query={tb}>
          {(data) => <TrialBalanceView tb={data} onOpen={(code) => openLedger(code, 'asOf')} />}
        </Loaded>
      )}
      {section === 'ledger' && (
        <LedgerSection
          code={ledgerCode}
          onCode={setLedgerCode}
          rangeControls={rangeControls}
          ledger={ledger}
        />
      )}
      {section === 'journals' && (
        <Loaded
          title="Journal entries"
          controls={
            <>
              {rangeControls}
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={manualOnly}
                  onChange={(e) => {
                    setManualOnly(e.target.checked);
                    setJournalPage(1);
                  }}
                />
                Manual journals only
              </label>
            </>
          }
          query={journals}
        >
          {(data) => (
            <JournalsTable
              entries={data.items}
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={setJournalPage}
              canPost={canPost}
              today={today}
            />
          )}
        </Loaded>
      )}
      {section === 'accounts' && (
        <Loaded title="Chart of accounts" query={accounts}>
          {(data) => (
            <ChartOfAccountsTable
              accounts={data}
              currency={periods.data?.currency ?? 'INR'}
              canManage={canManage}
              onOpen={(code) => openLedger(code, 'asOf')}
            />
          )}
        </Loaded>
      )}
      {section === 'periods' &&
        (periods.data ? (
          <PeriodsView overview={periods.data} canClose={canClose} timeZone={timeZone} />
        ) : (
          <Panel title="Period closing">
            <SkeletonLines lines={4} />
          </Panel>
        ))}

      {dialog === 'journal' && (
        <JournalDialogLoader today={today} lockedThrough={lockedThrough} onClose={() => setDialog(null)} />
      )}
      {dialog === 'account' && <AccountDialog account={null} onClose={() => setDialog(null)} />}
    </div>
  );
}

function LedgerSection({
  code,
  onCode,
  rangeControls,
  ledger,
}: {
  code: string | null;
  onCode: (code: string) => void;
  rangeControls: React.ReactNode;
  ledger: ReturnType<typeof useGeneralLedger>;
}) {
  const accounts = useAccounts(true);
  const picker = <AccountPicker accounts={accounts.data ?? []} value={code} onChange={onCode} />;
  if (!code) {
    return (
      <Panel title="General ledger" meta={<>{picker}{rangeControls}</>}>
        <p className="muted">Choose an account to see every entry that moved it, with a running balance.</p>
      </Panel>
    );
  }
  return (
    <Loaded title="General ledger" controls={<>{picker}{rangeControls}<PrintButton /></>} query={ledger}>
      {(data) => <GeneralLedgerView ledger={data} />}
    </Loaded>
  );
}

/** The journal form needs the current chart; load it only when the form opens. */
function JournalDialogLoader({ today, lockedThrough, onClose }: { today: string; lockedThrough: string | null; onClose: () => void }) {
  const accounts = useAccounts(false);
  if (!accounts.data) return null;
  return <NewJournalDialog accounts={accounts.data} today={today} lockedThrough={lockedThrough} onClose={onClose} />;
}

export default function AccountingPage() {
  const { data: session } = useSession();
  const canRead = hasPermission(session, 'accounting:read');
  // Only once the role is known to include the books — no pointless 403.
  const periods = usePeriods(canRead);

  if (session && !canRead) {
    return (
      <div className="stack">
        <PageHeader title="Accounting" subtitle="The books: statements, ledger, journals, and closing." />
        <div className="panel placeholder">
          <strong>Your role doesn&apos;t include the books.</strong>
          <p>Ask the business owner to add accounting access to your role if you need it.</p>
        </div>
      </div>
    );
  }
  if (!periods.data) {
    return (
      <div className="stack">
        <PageHeader title="Accounting" subtitle="The books: statements, ledger, journals, and closing." />
        <Panel title="Loading">
          {periods.error ? <ErrorState error={periods.error} onRetry={() => periods.refetch()} /> : <SkeletonLines lines={6} />}
        </Panel>
      </div>
    );
  }
  return <Books today={periods.data.today} lockedThrough={periods.data.lockedThrough} />;
}
