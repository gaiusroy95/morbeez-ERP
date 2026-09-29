'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AssetRow,
  FleetSettings,
  FuelRecord,
  HireBill,
  HireSuggestion,
  VehicleDetail,
  VehicleEconomicsReport,
  VehicleLoan,
  VehicleOverview,
} from '@morbeez/shared-types';
import { apiGet } from '../api/client';
import type { DateRange } from './use-accounting';

// Every fleet read shares the ['fleet'] root, so any fleet action refreshes them all.

const keep = <T,>(previous: T | undefined) => previous;

export const useFleet = (enabled = true) =>
  useQuery({ queryKey: ['fleet', 'vehicles'], queryFn: () => apiGet<VehicleOverview[]>('fleet/vehicles'), enabled });

export const useFleetVehicle = (id: string | null) =>
  useQuery({ queryKey: ['fleet', 'vehicle', id], queryFn: () => apiGet<VehicleDetail>(`fleet/vehicles/${id}`), enabled: id !== null });

export const useFuelLog = (range: DateRange | null) =>
  useQuery({
    queryKey: ['fleet', 'fuel', range],
    queryFn: () => apiGet<FuelRecord[]>('fleet/fuel', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useAssets = (enabled = true) =>
  useQuery({ queryKey: ['fleet', 'assets'], queryFn: () => apiGet<AssetRow[]>('fleet/assets'), enabled });

export const useLoans = (enabled = true) =>
  useQuery({ queryKey: ['fleet', 'loans'], queryFn: () => apiGet<VehicleLoan[]>('fleet/loans'), enabled });

export const useHireBills = (status: string | null, enabled = true) =>
  useQuery({
    queryKey: ['fleet', 'hire-bills', status],
    queryFn: () => apiGet<HireBill[]>('fleet/hire-bills', { status: status ?? undefined }),
    enabled,
    placeholderData: keep,
  });

export const useHireSuggestion = (vehicleId: string | null, range: DateRange | null) =>
  useQuery({
    queryKey: ['fleet', 'hire-suggestion', vehicleId, range],
    queryFn: () => apiGet<HireSuggestion>(`fleet/vehicles/${vehicleId}/hire-suggestion`, { from: range?.from, to: range?.to }),
    enabled: vehicleId !== null && range !== null && !!range.from && !!range.to && range.from <= range.to,
  });

export const useEconomics = (range: DateRange | null) =>
  useQuery({
    queryKey: ['fleet', 'economics', range],
    queryFn: () => apiGet<VehicleEconomicsReport>('fleet/economics', { from: range?.from, to: range?.to }),
    enabled: range !== null,
    placeholderData: keep,
  });

export const useFleetSettings = (enabled = true) =>
  useQuery({ queryKey: ['fleet', 'settings'], queryFn: () => apiGet<FleetSettings>('fleet/settings'), enabled });
