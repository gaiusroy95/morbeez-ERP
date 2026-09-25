# Migrations

Forward-only, backward-compatible (expand/contract pattern, Constitution
III.6), run with [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
against `DATABASE_URL`. A destructive migration (drop column/table) requires
a verified backup and a second engineer's sign-off.

```
pnpm --filter @morbeez/backend migrate:up
pnpm --filter @morbeez/backend migrate:down
pnpm --filter @morbeez/backend migrate:create <name>
```

Four migrations exist so far: the extensions/per-context-schema/RLS-helper
bootstrap; the `tenant` table; the Users context's identity tables
(`app_user`, `role`, `permission`, `role_permission`, `user_role`,
`auth_session`, all RLS-protected except the global `permission` catalog
and the join tables, which have none of their own); and the seeded
permission catalog. The full 67-table catalog from the Production Database
document lands here incrementally as each bounded context is implemented —
not in one migration.

**Known gap, tracked deliberately (see the identity-tables migration's own
comments):** the two `SECURITY DEFINER` functions login and token-refresh
need (`identity.find_user_for_login`, `identity.find_session_by_token_hash`)
are correct in principle but only become a *real* RLS boundary once the
application connects as a database role distinct from the migration-owning
role — today they're the same role, which already bypasses RLS by default
as the table owner. Provisioning that separate, least-privilege runtime
role is follow-up work, tied to `infrastructure/terraform` actually being
applied.
