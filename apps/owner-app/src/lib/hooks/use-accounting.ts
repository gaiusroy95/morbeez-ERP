'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AccountingTrialBalance,
  AccountRecord,
  BalanceSheet,
  CashFlowStatement,
  ClosePreview,
  GeneralLedger,
  JournalEntry,
  Paginated,
  PeriodsOverview,
  ProfitAndLoss,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// Every accounting read shares the ['accounting'] root, so any posting —
// a journal, a close, a new account — refreshes all statements at once.

export interface DateRange {
  from: string;
  to: string;
}

const keep = <T,>(previous: T | undefined) => previous;

export function usePeriods(enabled = true) {
  return useQuery({
    queryKey: ['accounting', 'periods'],
    queryFn: () => apiGet<PeriodsOverview>('accounting/periods'),
    enabled,
  });
}

export function useAccounts(includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: ['accounting', 'accounts', includeInactive],
    queryFn: () => apiGet<AccountRecord[]>('accounting/accounts', { includeInactive: includeInactive ? 'true' : undefined }),
    enabled,
    placeholderData: keep,
  });
}

export function useProfitAndLoss(range: DateRange | null) {
  return useQuery({
    queryKey: ['accounting', 'pnl', range],
    queryFn: () => apiGet<ProfitAndLoss>('accounting/profit-and-loss', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });
}

export function useBalanceSheet(asOf: string | null) {
  return useQuery({
    queryKey: ['accounting', 'balance-sheet', asOf],
    queryFn: () => apiGet<BalanceSheet>('accounting/balance-sheet', { asOf: asOf ?? undefined }),
    enabled: asOf !== null,
    placeholderData: keep,
  });
}

export function useCashFlowStatement(range: DateRange | null) {
  return useQuery({
    queryKey: ['accounting', 'cash-flow', range],
    queryFn: () => apiGet<CashFlowStatement>('accounting/cash-flow', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });
}

export function useTrialBalance(asOf: string | null) {
  return useQuery({
    queryKey: ['accounting', 'trial-balance', asOf],
    queryFn: () => apiGet<AccountingTrialBalance>('accounting/trial-balance', { asOf: asOf ?? undefined }),
    enabled: asOf !== null,
    placeholderData: keep,
  });
}

export function useGeneralLedger(code: string | null, range: DateRange | null) {
  return useQuery({
    queryKey: ['accounting', 'ledger', code, range],
    queryFn: () => apiGet<GeneralLedger>(`accounting/ledger/${code}`, { from: range?.from, to: range?.to }),
    enabled: code !== null && range !== null,
    placeholderData: keep,
  });
}

export function useJournalEntries(range: DateRange | null, manualOnly: boolean, page: number) {
  return useQuery({
    queryKey: ['accounting', 'journal-entries', range, manualOnly, page],
    queryFn: () =>
      apiGet<Paginated<JournalEntry> & { from: string; to: string }>('accounting/journal-entries', {
        from: range?.from,
        to: range?.to,
        manualOnly: manualOnly ? 'true' : undefined,
        page,
        pageSize: 25,
      }),
    enabled: range !== null,
    placeholderData: keep,
  });
}

export function useClosePreview(through: string | null) {
  return useQuery({
    queryKey: ['accounting', 'close-preview', through],
    queryFn: () => apiGet<ClosePreview>('accounting/periods/close-preview', { through: through ?? undefined }),
    enabled: through !== null && /^\d{4}-\d{2}-\d{2}$/.test(through),
  });
}
