import { create } from 'zustand';

// Local UI state only (open panels, chosen views). Server state lives in
// TanStack Query, not here (System Architecture, FE.2).

export type DashboardRange = 7 | 30 | 90;

interface UiState {
  dashboardRange: DashboardRange;
  setDashboardRange: (range: DashboardRange) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  dashboardRange: 30,
  setDashboardRange: (dashboardRange) => set({ dashboardRange }),
  navOpen: false,
  setNavOpen: (navOpen) => set({ navOpen }),
}));
