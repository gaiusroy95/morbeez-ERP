# Morbeez Owner App

React 18 + TypeScript on Next.js — the web application for owners,
procurement, inventory, delivery, finance, and accounting staff (Technology
Stack, Section 01).

## Running it

```sh
cp .env.example .env.local        # API_BASE_URL → the NestJS backend
pnpm --filter @morbeez/owner-app dev
```

Sign in with a seeded dev login (`pnpm db:seed` prints them), e.g.
`owner@dev.morbeez.local`.

## How it talks to the backend

The browser never calls the backend and never holds a token. Tokens live in
httpOnly cookies; every data request goes to the same-origin proxy at
`/api/backend/*` (`src/app/api/backend`), which attaches the access token
server-side and refreshes it transparently. Concurrent refreshes for the same
token share one backend call (the backend rotates refresh tokens, so racing
refreshes would otherwise sign the user out) — that de-duplication is
per-process, so running several instances needs sticky sessions or a shared
store. `src/middleware.ts` sends signed-out visitors to `/login`.

## Structure

- `src/app/(modules)/` — one route group per bounded context (System
  Architecture, FE.4), inside the shared app shell. `dashboard/` is built;
  the rest are placeholders until their screens are built.
- `src/components/dashboard/` — alerts, KPIs, profit, and today's
  operations; each panel loads and fails independently.
- `src/components/ui/` — shared panel, loading, and error states (FE.3).
- `src/lib/api/` — the typed client for the proxy.
- `src/lib/hooks/` — TanStack Query hooks (server state, FE.2) and the
  session hook.
- `src/lib/stores/` — local UI state only (Zustand).
- Response types come from `@morbeez/shared-types`.

Permissions hide menu items and panels for usability, but the backend is the
real gate (FE.5) — nothing here is a security boundary.

## Design

"Fresh Ledger": a carbon frame (sidebar, sign-in) around a light workspace,
emerald for the brand, lime for what is active. All colours are tokens at
the top of `src/app/globals.css`; components never hard-code one. The same
system is used by the Android app (`apps/driver-app/.../ui/theme/Theme.kt`).

Every `color-mix()` sits in an `@supports` block at the end of
`globals.css`, after a plain-colour fallback in the rule itself: Android
WebViews older than Chrome 111 otherwise drop the whole declaration.

Fonts: Inter and Bricolage Grotesque, SIL Open Font License 1.1, bundled in
`src/app/fonts` (latin subset, variable weight), so no build needs Google.
