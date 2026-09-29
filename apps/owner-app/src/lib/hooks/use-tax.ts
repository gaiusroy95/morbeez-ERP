'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CustomerTaxRow,
  FarmerTaxRow,
  Gstr1,
  Gstr3b,
  GstRateView,
  ProductTaxRow,
  TaxInvoiceRow,
  TaxProfile,
  TaxReference,
  TdsRegister,
  TdsSectionView,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import type { DateRange } from './use-accounting';

// Every tax read shares the ['tax'] root, so any tax action refreshes them all.

const keep = <T,>(previous: T | undefined) => previous;

export const useTaxReference = () =>
  useQuery({ queryKey: ['tax', 'reference'], queryFn: () => apiGet<TaxReference>('tax/reference'), staleTime: Infinity });

export const useTaxProfile = () => useQuery({ queryKey: ['tax', 'profile'], queryFn: () => apiGet<TaxProfile>('tax/profile') });

export const useGstRates = (enabled = true) =>
  useQuery({ queryKey: ['tax', 'gst-rates'], queryFn: () => apiGet<GstRateView[]>('tax/gst-rates'), enabled });

export const useTdsSections = (enabled = true) =>
  useQuery({ queryKey: ['tax', 'tds-sections'], queryFn: () => apiGet<TdsSectionView[]>('tax/tds-sections'), enabled });

export const useProductTax = (enabled = true) =>
  useQuery({ queryKey: ['tax', 'products'], queryFn: () => apiGet<ProductTaxRow[]>('tax/products'), enabled });

export const useCustomerTax = (enabled = true) =>
  useQuery({ queryKey: ['tax', 'customers'], queryFn: () => apiGet<CustomerTaxRow[]>('tax/customers'), enabled });

export const useFarmerTax = (enabled = true) =>
  useQuery({ queryKey: ['tax', 'farmers'], queryFn: () => apiGet<FarmerTaxRow[]>('tax/farmers'), enabled });

export const useTaxInvoices = (range: DateRange | null) =>
  useQuery({
    queryKey: ['tax', 'invoices', range],
    queryFn: () => apiGet<TaxInvoiceRow[]>('tax/invoices', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useGstr1 = (range: DateRange | null) =>
  useQuery({
    queryKey: ['tax', 'gstr1', range],
    queryFn: () => apiGet<Gstr1>('tax/gstr1', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useGstr3b = (range: DateRange | null) =>
  useQuery({
    queryKey: ['tax', 'gstr3b', range],
    queryFn: () => apiGet<Gstr3b>('tax/gstr3b', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useTdsRegister = (fy: string, quarter: 1 | 2 | 3 | 4, enabled = true) =>
  useQuery({
    queryKey: ['tax', 'tds', fy, quarter],
    queryFn: () => apiGet<TdsRegister>('tax/tds/register', { fy, quarter }),
    enabled,
    placeholderData: keep,
  });
