'use client';

import { useQuery } from '@tanstack/react-query';
import type { AgentRecord, ProcurementBoard, ProcurementBoardDay } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

/** The owner's Procurement list (redesign V1.1): cards for today, tomorrow or all days, searchable. */
export function useProcurementBoard(day: ProcurementBoardDay, q: string) {
  return useQuery({
    queryKey: ['procurement', 'board', day, q],
    queryFn: () => apiGet<ProcurementBoard>('procurement/board', { day, q: q.trim() || undefined, pageSize: 100 }),
    placeholderData: (previous) => previous,
  });
}

export function useAgents() {
  return useQuery({ queryKey: ['procurement', 'agents'], queryFn: () => apiGet<AgentRecord[]>('procurement/agents') });
}

/** "P-00123". */
export const formatPoNumber = (n: number) => `P-${String(n).padStart(5, '0')}`;
