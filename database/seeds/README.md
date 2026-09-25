# Seeds

Synthetic fixture data for local/dev environments only — tests and seeds
never read, write, or depend on real tenant data (Constitution VI.5).

```
pnpm --filter @morbeez/backend seed
```

`run.ts` refuses to execute when `NODE_ENV=production`, on top of whatever
environment isolation already exists (Constitution VII, blast-radius
containment) — a seed script is exactly the kind of thing that's cheap to
misfire against the wrong database once, so it checks.

Each `NNN_description.ts` file exports a `seed(client)` function and runs in
numeric-prefix order. `001` seeds a dev tenant; `002` seeds a standard
"Owner" role carrying every permission in the catalog and one dev login
(printed to the console on first run) — enough to exercise the full
authentication flow (`POST /auth/login`) without hand-writing SQL.
