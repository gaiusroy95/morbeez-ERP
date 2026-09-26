# Morbeez Driver App

Kotlin + Jetpack Compose, native Android (Technology Stack, Section 02) —
the one client that has to work with no connectivity at all, for hours, and
reconcile cleanly when it comes back. Implements the architecture in the
"Morbeez Driver App Architecture" document (offline-first data, sync
engine, secure local storage, trip-based permissions).

## Features

- **Login** — `ui/screens/login`, session tokens in `TokenStore`.
- **Assigned trips** — `ui/screens/route` (Today's Trip + Route), pulled
  from the driver-scoped `GET /logistics/trips/mine`, never a client-side
  filter over every trip.
- **Pickup** — completing a pickup stop from `ui/screens/stopdetail`.
- **Delivery** — `ui/screens/delivery`, proof of delivery (recipient name
  + signature or photo).
- **Photos** — `ui/components/PhotoCapture.kt`, used from pickup, delivery,
  and issue-report flows alike.
- **POD** — `SignaturePad.kt` + the 'pod' photo type; enforced client-side
  before submission and again by the backend.
- **Collections** — `ui/screens/cash`, cash/payment collected at a
  delivery stop.
- **Expenses** — `ui/screens/expenses`, Trip Summary and recording a new
  expense.
- **Sync** — `data/sync/SyncEngine.kt`, run by `SyncWorker` via
  WorkManager: an operation log, pushed in strict order before any pull,
  replaying against the exact same backend handlers the web app uses.

## Structure

- `data/local` — Room (SQLCipher-encrypted), the on-device source of truth
  while offline: `TripEntity`/`TripStopEntity` plus the
  `PendingOperationEntity`/`PendingPhotoEntity` queues.
- `data/remote` — the typed Retrofit client (`ApiService`), auth
  interceptor/authenticator.
- `data/repository` — `TripRepository`/`AuthRepository`: the only classes
  screens talk to; the only classes that talk to `ApiService`.
- `data/security` — `TokenStore` and `DatabaseKeyProvider`, both backed by
  the Android Keystore via `EncryptedSharedPreferences`.
- `data/sync` — the operation-log sync engine, run via WorkManager.
- `di` — Hilt modules wiring the above.
- `ui` — Compose screens, one package per feature, plus shared
  `components` (photo capture, signature pad) and the `nav` graph.

Chosen native over cross-platform specifically for this app's reliability
requirements — see the Technology Stack document (Section 02) for the full
reasoning and the trade-off it makes explicit.

## Known gaps

Written but not build-verified in this environment (no Android SDK/Gradle
toolchain available) — unlike the backend, which is fully type-checked and
tested. Two things a real build pass would need to confirm:

- Exact dependency versions in `app/build.gradle.kts` resolve together
  (Compose BOM, Hilt, Room/KSP, SQLCipher).
- `BASE_URL` in `di/NetworkModule.kt` is a placeholder — wire it to a real
  per-environment build config before this talks to an actual backend.
