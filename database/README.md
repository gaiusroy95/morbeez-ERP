# Database

- `migrations/` — sequential, forward-only schema migrations
- `seeds/` — synthetic fixture data for local/dev
- `schemas/` — one folder per Postgres schema, matching bounded-context
  ownership (System Architecture, DB.3) — see the Production Database
  document for the full 67-table catalog this structure implements.
- `scripts/schema-report.js` — writes `docs/architecture/database-erd.md`
  (ERD, keys, RLS, indexes and their review) from a migrated database:
  `DATABASE_URL=… node database/scripts/schema-report.js`.

Every table of one business's data carries `tenant_id` with row-level
security enabled and forced; `testing/e2e/suites/tenant-isolation-e2e.js`
fails if a migration adds one without it. A migration that's been committed
has run on Neon: change the schema with a new one, never by editing it.

Migrations run as the database's non-superuser owner, which forced RLS hides
every row from. A migration that reads or writes rows — a backfill, or
granting a permission to the existing roles (`identity.role_permission`,
since `20261112081000`) — lifts it around that work:
`ALTER TABLE … NO FORCE ROW LEVEL SECURITY` … `FORCE ROW LEVEL SECURITY`.
