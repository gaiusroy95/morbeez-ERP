'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../api/client';

/**
 * One state-changing call from a screen. After it succeeds, every query
 * under `invalidates` refetches — so the list, the open detail panel, and
 * the dashboard all show the new state without the screen tracking which.
 * A write in one module usually moves figures in another (delivering an
 * order changes stock and receivables), so callers name all of them.
 */
export function useAction<TInput, TResult>(
  run: (input: TInput) => Promise<TResult>,
  invalidates: QueryKey[],
  onDone?: (result: TResult) => void,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (result) => {
      // Almost every write posts to the ledger (deliveries, grading,
      // payments, trip cash, write-offs), many create tax records, and a
      // completed trip records its driver's work — so the books, tax and
      // workforce views always refresh too.
      const keys = [...invalidates, KEYS.accounting, KEYS.tax, KEYS.workforce];
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
      onDone?.(result);
    },
  });
}

/** What to tell someone whose action failed. */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // The server's own words when it gave any — a 403 isn't always a role
    // problem (the proxy's cross-origin refusal is one too).
    if (error.status === 403 && /^Request failed/.test(error.message)) return "Your role isn't allowed to do this.";
    if (error.status === 409)
      return `${error.message} Someone may have changed this record just now — close and reopen it, then try again.`;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

// Query-key roots, shared so an action invalidates exactly what a read uses.
export const KEYS = {
  orders: ['orders'],
  procurement: ['procurement'],
  inventory: ['inventory'],
  logistics: ['logistics'],
  customers: ['customers'],
  finance: ['finance'],
  dashboard: ['dashboard'],
  lookupCustomers: ['lookup', 'customers'],
  approvals: ['approvals'],
  accounting: ['accounting'],
  tax: ['tax'],
  workforce: ['workforce'],
  fleet: ['fleet'],
  crates: ['crates'],
  lookupVehicles: ['lookup', 'vehicles'],
  spot: ['spot'],
  ai: ['ai'],
  delegation: ['delegation'],
  alerts: ['alerts'],
} satisfies Record<string, QueryKey>;
