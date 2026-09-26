'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CustomerRecord,
  EmployeeRecord,
  FarmerRecord,
  Paginated,
  ProductRecord,
  VehicleRecord,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import { hasPermission, useSession } from './use-tenant';

// List endpoints return ids (customerId, productId, …); these resolve them
// to names. One page of 100 — the server's ceiling (Constitution IV.5) — is
// enough for a wholesaler's master data today; an id beyond it falls back
// to a short reference rather than failing. Only fetched when the role can
// read that master list, so a missing permission shows references, not 403s.

const LOOKUP_PAGE = 100;
const LOOKUP_STALE_MS = 5 * 60_000;

export interface TenantProfile {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

export function useTenantProfile() {
  return useQuery({
    queryKey: ['tenant', 'me'],
    queryFn: () => apiGet<TenantProfile>('tenants/me'),
    staleTime: LOOKUP_STALE_MS,
  });
}

/** The tenant's currency, defaulting to INR only until the profile loads. */
export function useCurrency(): string {
  return useTenantProfile().data?.currency ?? 'INR';
}

function useNameMap<T extends { id: string }>(
  key: string,
  path: string,
  permission: string,
  label: (record: T) => string,
) {
  const { data: session } = useSession();
  const allowed = hasPermission(session, permission);
  const query = useQuery({
    queryKey: ['lookup', key],
    queryFn: () => apiGet<Paginated<T>>(path, { page: 1, pageSize: LOOKUP_PAGE }),
    enabled: allowed,
    staleTime: LOOKUP_STALE_MS,
    select: (page) => new Map(page.items.map((record) => [record.id, { label: label(record), record }])),
  });
  return (id: string | null | undefined): string => {
    if (!id) return '—';
    return query.data?.get(id)?.label ?? shortRef(id);
  };
}

export function shortRef(id: string): string {
  return `#${id.slice(0, 8)}`;
}

export function useCustomerName() {
  return useNameMap<CustomerRecord>('customers', 'customers', 'customers:read', (c) => c.name);
}

export function useFarmerName() {
  return useNameMap<FarmerRecord>('farmers', 'farmers', 'farmers:read', (f) => f.name);
}

export function useProductName() {
  return useNameMap<ProductRecord>('products', 'products', 'products:read', (p) => p.name);
}

export function useProductUom() {
  return useNameMap<ProductRecord>('products', 'products', 'products:read', (p) => p.baseUom);
}

export function useVehicleName() {
  return useNameMap<VehicleRecord>('vehicles', 'vehicles', 'vehicles:read', (v) => v.registrationNumber);
}

export function useEmployeeName() {
  return useNameMap<EmployeeRecord>('employees', 'workforce', 'workforce:read', (e) => e.name);
}
