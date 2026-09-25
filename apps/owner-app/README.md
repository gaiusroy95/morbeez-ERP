# Morbeez Owner App

React 18 + TypeScript on Next.js — the web application for owners,
procurement, inventory, delivery, finance, and accounting staff (Technology
Stack, Section 01).

- `src/app/(modules)/` — one route group per bounded context, lazily loaded
  (System Architecture, FE.4) — mirrors the backend's module boundaries
- `src/components/ui/` — the shared internal design system (tables, forms,
  unit-aware money/weight inputs) used across every module (FE.3)
- `src/lib/api/` — the typed API client against the backend's OpenAPI contract
- `src/lib/stores/` — local UI state only (Zustand); server state is
  TanStack Query, not this store (FE.2)

RBAC hides menu items and actions per role for usability, but the server is
the real gate (FE.5) — nothing here should be trusted as a security boundary.
