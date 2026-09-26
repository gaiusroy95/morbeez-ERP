# Migrations

Forward-only, backward-compatible (expand/contract pattern, Constitution
III.6), run with [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
against `DATABASE_URL` — the migration-owning role. A destructive migration
(drop column/table) requires a verified backup and a second engineer's
sign-off.

```
pnpm --filter @morbeez/backend migrate:up
pnpm --filter @morbeez/backend migrate:down
pnpm --filter @morbeez/backend migrate:create <name>
```

Six migrations exist so far: the extensions/per-context-schema/RLS-helper
bootstrap; the `tenant` table; the Users context's identity tables
(`app_user`, `role`, `permission`, `role_permission`, `user_role`,
`auth_session`); the seeded permission catalog; **`morbeez_app`, a second,
restricted database role with DML-only grants and `FORCE ROW LEVEL
SECURITY`** on every RLS-protected table — this is what the previous
version of this README tracked as a known gap ("RLS is correct in
principle but the app connects as the same role that owns the tables,
which bypasses it") and is now closed; and the `tenant:*` permissions.
`APP_DATABASE_URL` (not `DATABASE_URL`) is what the running application
actually connects with from here on — see
`apps/backend/src/infra/database/database.service.ts`.

Thirteen migrations total as of the master-data modules: the six above,
plus `infra.audit_log` (insert-only — `UPDATE`/`DELETE` explicitly revoked
from `morbeez_app` right after creation, narrower than its schema's
default DML grant) and one table each for the five master-data contexts
— `customer`, `farmer` (with `bank_details_encrypted`, a `bytea` column
via pgcrypto, never plain `jsonb`), `product`, `vehicle`, and `employee`
— plus the permission codes each of those five needs
(`add-master-data-permissions`). Every one of these six new tables carries
`version integer` for optimistic concurrency (Production Database, Section
03) and is RLS-protected the same way the identity tables are.

Sixteen migrations total as of the approval framework: the thirteen above,
plus a new `approvals` schema (not one of the original nine — a
deliberate extension to the Domain Model, no "Approvals" bounded context
existed there) and its four tables (`approval_rule`, `approval_role_limit`,
`approval_request`, `approval_delegation`), plus `approvals:read`/`manage`.
Two things enforced at the database, not just in
`modules/approvals/approvals.service.ts`: a requester can never be their
own approver (`approval_request_decider_differs_from_requester`, a CHECK
constraint — Constitution V.1's defense in depth, generalized from the
Accounting Engine's CN.4), and a delegation is always time-boxed, capped
at 180 days (`approval_delegation_window_valid`).

The full 67-table catalog from the Production Database document lands here
incrementally as each bounded context is implemented — not in one
migration. `test/integration/tenant-isolation.integration-spec.ts` in the
backend is the actual proof that the RLS + role-separation described above
holds against a real database, not just documentation of intent.
