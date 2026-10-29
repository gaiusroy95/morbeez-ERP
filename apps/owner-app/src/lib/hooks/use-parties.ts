'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CustomerProfile,
  CustomersBoard,
  CustomersFilter,
  CustomerStatement,
  FarmerProfile,
  FarmersBoard,
  FarmersFilter,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';

/** The owner's Customers list (redesign V1.1): filters, route, search. */
export function useCustomersBoard(filter: CustomersFilter, routeId: string, q: string) {
  return useQuery({
    queryKey: ['customers', 'board', filter, routeId, q],
    queryFn: () => apiGet<CustomersBoard>('customers/board', { filter, routeId: routeId || undefined, q: q.trim() || undefined, pageSize: 200 }),
    placeholderData: (previous) => previous,
  });
}

export function useCustomerProfile(id: string | null) {
  return useQuery({
    queryKey: ['customers', 'profile', id],
    queryFn: () => apiGet<CustomerProfile>(`customers/${id}/profile`),
    enabled: id !== null,
  });
}

/** Their invoices and payments, line by line, for the last [days]. */
export function useCustomerStatement(id: string | null, days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['finance', 'statement', id, days],
    queryFn: () => apiGet<CustomerStatement>(`finance/customers/${id}/statement`, { days }),
    enabled: enabled && id !== null,
  });
}

/** The owner's Farmers list (redesign V1.1): filters, village or town, search. */
export function useFarmersBoard(filter: FarmersFilter, place: string, q: string) {
  return useQuery({
    queryKey: ['farmers', 'board', filter, place, q],
    queryFn: () => apiGet<FarmersBoard>('farmers/board', { filter, place: place || undefined, q: q.trim() || undefined, pageSize: 200 }),
    placeholderData: (previous) => previous,
  });
}

export function useFarmerProfile(id: string | null) {
  return useQuery({
    queryKey: ['farmers', 'profile', id],
    queryFn: () => apiGet<FarmerProfile>(`farmers/${id}/profile`),
    enabled: id !== null,
  });
}
