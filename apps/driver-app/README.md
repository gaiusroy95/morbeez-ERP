# Morbeez Driver App

Kotlin + Jetpack Compose, native Android (Technology Stack, Section 02) —
the one client that has to work with no connectivity at all, for hours, and
reconcile cleanly when it comes back.

- `ui/screens/route` — today's stop sequence (server-computed; this screen
  only renders and reports deviations)
- `ui/screens/delivery` — delivery confirmation and proof of delivery
- `ui/screens/cash` — cash/payment collection
- `ui/screens/shortage` — delivered-short reporting
- `data/local` — Room, the on-device source of truth while offline
- `data/sync` — the operation-log sync engine, run via WorkManager
- `data/remote` — the typed API client

Chosen native over cross-platform specifically for this app's reliability
requirements — see the Technology Stack document (Section 02) for the full
reasoning and the trade-off it makes explicit.
