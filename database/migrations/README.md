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

Two migrations exist so far, both infrastructure rather than business
schema: the extensions/per-context-schema/RLS-helper bootstrap, and the
`tenant` table itself (the one table every RLS policy depends on existing).
The full 67-table catalog from the Production Database document lands here
incrementally as each bounded context is implemented — not in one migration.
