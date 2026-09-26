'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CashFlowReport,
  CustomerRecord,
  LotRecord,
  OrderRecord,
  OrderStatus,
  Paginated,
  PayablesReport,
  PickupRecord,
  ProductStockRow,
  PurchaseOrderRecord,
  PurchaseOrderStatus,
  ReceivablesReport,
  FarmerSettlementRecord,
  TripCashReport,
  TripExpenseRecord,
  TripReconciliationRecord,
  TripRecord,
  TripStatus,
  TripStopRecord,
  UnsettledLot,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// Query hooks for the owner modules. Server state only — filters and the
// selected row live in each page's own component state.

const PAGE_SIZE = 25;
const keep = <T,>(previous: T | undefined) => previous;

// ---- Orders ----

export function useOrders(status: OrderStatus | undefined, page: number) {
  return useQuery({
    queryKey: ['orders', 'list', status ?? 'all', page],
    queryFn: () => apiGet<Paginated<OrderRecord>>('orders', { status, page, pageSize: PAGE_SIZE }),
    placeholderData: keep,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: () => apiGet<OrderRecord>(`orders/${id}`),
    enabled: id !== null,
  });
}

// ---- Procurement ----

export function usePurchaseOrders(status: PurchaseOrderStatus | undefined, page: number) {
  return useQuery({
    queryKey: ['procurement', 'purchase-orders', status ?? 'all', page],
    queryFn: () =>
      apiGet<Paginated<PurchaseOrderRecord>>('procurement/purchase-orders', { status, page, pageSize: PAGE_SIZE }),
    placeholderData: keep,
  });
}

export function usePurchaseOrder(id: string | null) {
  return useQuery({
    queryKey: ['procurement', 'purchase-order', id],
    queryFn: async () => {
      // Sequential: the detail is small, and one failure should fail the panel.
      const order = await apiGet<PurchaseOrderRecord>(`procurement/purchase-orders/${id}`);
      const lots = await apiGet<LotRecord[]>(`procurement/purchase-orders/${id}/lots`);
      const pickups = await apiGet<PickupRecord[]>(`procurement/purchase-orders/${id}/pickups`);
      const settlements = await apiGet<FarmerSettlementRecord[]>(`procurement/purchase-orders/${id}/settlements`);
      return { order, lots, pickups, settlements };
    },
    enabled: id !== null,
  });
}

// ---- Inventory ----

export function useStockOverview() {
  return useQuery({
    queryKey: ['inventory', 'stock'],
    queryFn: () => apiGet<ProductStockRow[]>('inventory/stock'),
  });
}

export function useProductLots(productId: string | null) {
  return useQuery({
    queryKey: ['inventory', 'lots', productId],
    queryFn: () => apiGet<LotRecord[]>(`inventory/products/${productId}/lots`),
    enabled: productId !== null,
  });
}

// ---- Logistics ----

export function useTrips(status: TripStatus | undefined, page: number) {
  return useQuery({
    queryKey: ['logistics', 'trips', status ?? 'all', page],
    queryFn: () => apiGet<Paginated<TripRecord>>('logistics/trips', { status, page, pageSize: PAGE_SIZE }),
    placeholderData: keep,
  });
}

export function useTripDetail(id: string | null) {
  return useQuery({
    queryKey: ['logistics', 'trip', id],
    queryFn: async () => {
      const stops = await apiGet<TripStopRecord[]>(`logistics/trips/${id}/stops`);
      const expenses = await apiGet<TripExpenseRecord[]>(`logistics/trips/${id}/expenses`);
      // null until the trip has been reconciled.
      const reconciliation = await apiGet<TripReconciliationRecord | null>(`logistics/trips/${id}/reconciliation`);
      return { stops, expenses, reconciliation };
    },
    enabled: id !== null,
  });
}

// ---- Customers ----

export function useCustomers(page: number) {
  return useQuery({
    queryKey: ['customers', 'list', page],
    queryFn: () => apiGet<Paginated<CustomerRecord>>('customers', { page, pageSize: PAGE_SIZE }),
    placeholderData: keep,
  });
}

// ---- Finance ----

export function useReceivables(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'receivables'],
    queryFn: () => apiGet<ReceivablesReport>('finance/receivables'),
    enabled,
  });
}

export function usePayables() {
  return useQuery({
    queryKey: ['finance', 'payables'],
    queryFn: () => apiGet<PayablesReport>('finance/payables'),
  });
}

export function useUnsettledLots(farmerId: string | null) {
  return useQuery({
    queryKey: ['finance', 'unsettled-lots', farmerId],
    queryFn: () => apiGet<UnsettledLot[]>(`finance/payables/${farmerId}/lots`),
    enabled: farmerId !== null,
  });
}

export function useCashFlow(days: number) {
  return useQuery({
    queryKey: ['finance', 'cash-flow', days],
    queryFn: () => apiGet<CashFlowReport>('finance/cash-flow', { days }),
    placeholderData: keep,
  });
}

export function useTripCash() {
  return useQuery({
    queryKey: ['finance', 'trip-cash'],
    queryFn: () => apiGet<TripCashReport>('finance/trip-cash'),
  });
}
