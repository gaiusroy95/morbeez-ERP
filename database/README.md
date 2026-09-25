# Database

- `migrations/` — sequential, forward-only schema migrations
- `seeds/` — synthetic fixture data for local/dev
- `schemas/` — one folder per Postgres schema, matching bounded-context
  ownership (System Architecture, DB.3) — see the Production Database
  document for the full 67-table catalog this structure implements.
