'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AdvanceRecord,
  AssignmentRecord,
  EarningsPreview,
  IncentiveRule,
  MinimumWageRate,
  PayrollSettings,
  SettlementRecord,
  WorkerDetail,
  WorkerRow,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import type { DateRange } from './use-accounting';

// Every workforce read shares the ['workforce'] root, so any action
// refreshes them all.

const keep = <T,>(previous: T | undefined) => previous;

export const useWorkers = (enabled = true) =>
  useQuery({ queryKey: ['workforce', 'workers'], queryFn: () => apiGet<WorkerRow[]>('workforce/workers'), enabled });

export const useWorker = (id: string | null) =>
  useQuery({ queryKey: ['workforce', 'worker', id], queryFn: () => apiGet<WorkerDetail>(`workforce/workers/${id}`), enabled: id !== null });

export const useAssignments = (range: DateRange | null) =>
  useQuery({
    queryKey: ['workforce', 'assignments', range],
    queryFn: () => apiGet<AssignmentRecord[]>('workforce/assignments', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useEarnings = (range: DateRange | null) =>
  useQuery({
    queryKey: ['workforce', 'earnings', range],
    queryFn: () => apiGet<EarningsPreview[]>('workforce/earnings', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useSettlements = (status: string | null, enabled = true) =>
  useQuery({
    queryKey: ['workforce', 'settlements', status],
    queryFn: () => apiGet<SettlementRecord[]>('workforce/settlements', { status: status ?? undefined }),
    enabled,
    placeholderData: keep,
  });

export const useSettlement = (id: string | null) =>
  useQuery({ queryKey: ['workforce', 'settlement', id], queryFn: () => apiGet<SettlementRecord>(`workforce/settlements/${id}`), enabled: id !== null });

export const useAdvances = (enabled = true) =>
  useQuery({ queryKey: ['workforce', 'advances'], queryFn: () => apiGet<AdvanceRecord[]>('workforce/advances'), enabled });

export const useIncentiveRules = (enabled = true) =>
  useQuery({ queryKey: ['workforce', 'incentive-rules'], queryFn: () => apiGet<IncentiveRule[]>('workforce/incentive-rules'), enabled });

export const useMinimumWages = (enabled = true) =>
  useQuery({ queryKey: ['workforce', 'minimum-wages'], queryFn: () => apiGet<MinimumWageRate[]>('workforce/minimum-wages'), enabled });

export const usePayrollSettings = (enabled = true) =>
  useQuery({ queryKey: ['workforce', 'payroll-settings'], queryFn: () => apiGet<PayrollSettings>('workforce/payroll/settings'), enabled });
