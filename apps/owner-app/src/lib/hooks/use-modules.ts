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
  LotPaymentStatus,
  TripCashReport,
  TripExpenseRecord,
  TripReconciliationRecord,
  TripRecord,
  TripStatus,
  TripStopRecord,
  PayableLot,
  ApprovalRequestRecord,
  CustomerCreditStatus,
  InvoiceRecord,
  LocationRecord,
  CustomerCollectionRecord,
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
      // What each graded lot owes the farmer and has been paid, from Finance.
      const payments = await apiGet<LotPaymentStatus[]>(`procurement/purchase-orders/${id}/settlements`);
      return { order, lots, pickups, payments };
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

export function useTrips(status: TripStatus | undefined, page: number, enabled = true) {
  return useQuery({
    queryKey: ['logistics', 'trips', status ?? 'all', page],
    queryFn: () => apiGet<Paginated<TripRecord>>('logistics/trips', { status, page, pageSize: PAGE_SIZE }),
    placeholderData: keep,
    enabled,
  });
}

export function useTripDetail(id: string | null) {
  return useQuery({
    queryKey: ['logistics', 'trip', id],
    queryFn: async () => {
      // The trip itself too, not the list row: actions need its current version.
      const trip = await apiGet<TripRecord>(`logistics/trips/${id}`);
      const stops = await apiGet<TripStopRecord[]>(`logistics/trips/${id}/stops`);
      const expenses = await apiGet<TripExpenseRecord[]>(`logistics/trips/${id}/expenses`);
      // null until the trip has been reconciled.
      const reconciliation = await apiGet<TripReconciliationRecord | null>(`logistics/trips/${id}/reconciliation`);
      return { trip, stops, expenses, reconciliation };
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

export function usePayableLots(farmerId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payable-lots', farmerId],
    queryFn: () => apiGet<PayableLot[]>(`finance/payables/${farmerId}/lots`),
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

export function useOpenInvoices(customerId: string | null) {
  return useQuery({
    queryKey: ['finance', 'open-invoices', customerId],
    // Oldest first is how a payment is applied by default; 100 open invoices
    // is far beyond one wholesale customer's normal backlog.
    queryFn: () =>
      apiGet<Paginated<InvoiceRecord>>('finance/invoices', { customerId, state: 'open', page: 1, pageSize: 100 }),
    enabled: customerId !== null,
  });
}

export function useCustomerCredit(customerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['finance', 'credit', customerId],
    queryFn: () => apiGet<CustomerCreditStatus>(`finance/customers/${customerId}/credit`),
    enabled: enabled && customerId !== null,
  });
}

// ---- Approvals ----

export function useApprovalRequest(id: string | null) {
  return useQuery({
    queryKey: ['approvals', id],
    queryFn: () => apiGet<ApprovalRequestRecord>(`approval-requests/${id}`),
    enabled: id !== null,
  });
}

// ---- Pick-lists that depend on workflow state ----

/** Confirmed orders — the ones a delivery stop can be added for. */
export function useConfirmedOrders(enabled: boolean) {
  return useQuery({
    queryKey: ['orders', 'list', 'confirmed', 'picker'],
    queryFn: () => apiGet<Paginated<OrderRecord>>('orders', { status: 'confirmed', page: 1, pageSize: 100 }),
    enabled,
  });
}

/** Confirmed purchase orders — the ones whose pickups a trip can collect. */
export function useConfirmedPurchaseOrders(enabled: boolean) {
  return useQuery({
    queryKey: ['procurement', 'purchase-orders', 'confirmed', 'picker'],
    queryFn: () =>
      apiGet<Paginated<PurchaseOrderRecord>>('procurement/purchase-orders', { status: 'confirmed', page: 1, pageSize: 100 }),
    enabled,
  });
}

export function usePickups(purchaseOrderId: string | null) {
  return useQuery({
    queryKey: ['procurement', 'pickups', purchaseOrderId],
    queryFn: () => apiGet<PickupRecord[]>(`procurement/purchase-orders/${purchaseOrderId}/pickups`),
    enabled: purchaseOrderId !== null,
  });
}

export function useLocations(enabled: boolean) {
  return useQuery({
    queryKey: ['inventory', 'locations'],
    queryFn: () => apiGet<Paginated<LocationRecord>>('inventory/locations', { page: 1, pageSize: 100 }),
    enabled,
  });
}

export function useStopCollections(tripId: string, stopId: string | null) {
  return useQuery({
    queryKey: ['logistics', 'trip', tripId, 'collections', stopId],
    queryFn: () => apiGet<CustomerCollectionRecord[]>(`logistics/trips/${tripId}/stops/${stopId}/collections`),
    enabled: stopId !== null,
  });
}

/** One customer by id — for a selection that isn't on the list page showing. */
export function useCustomer(id: string | null) {
  return useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => apiGet<CustomerRecord>(`customers/${id}`),
    enabled: id !== null,
  });
}
