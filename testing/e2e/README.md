# End-to-end suites

These run the real API and owner app against a real database. The API
connects as `morbeez_app`, so row-level security applies to every request,
as it does in production. Each suite logs in as the seeded roles (owner,
ops manager, accountant), works through a module over HTTP or in a browser,
and checks every figure exactly: money is compared as strings or paise,
never as floats.

| Chain | Suites, in order | Covers |
|---|---|---|
| `modules` | owner-modules → accounting → tax → workforce → fleet → crates → spot → ai (API suite, then UI suite, for each) | ~330 checks across the owner app |
| `finance` | owner-modules → finance | credit, aging, finance charges, the ledger |

Within a chain, each suite builds on what the earlier ones left behind. For
example, workforce needs the driver's completed trips, and fleet needs the
books closed through last month. So a chain always runs whole and in order,
on a fresh database. When you add a module, add its suites at the end of
`modules` in `run.js`.

## Running

Prerequisites:

- The API is built: `pnpm --filter @morbeez/backend build`.
- The owner app is built: `pnpm --filter @morbeez/owner-app build`.
- Postgres 16 is running, with a non-superuser owner role (`migrator`, as
  RDS's master user is).
- Redis is optional. Without it, the API falls back to in-memory rate limits.

```sh
export E2E_ADMIN_URL=postgres://postgres:pw@localhost:5432/postgres        # superuser
export E2E_DB_URL=postgres://postgres:pw@localhost:5432/morbeez_e2e        # superuser
export E2E_MIGRATE_URL=postgres://migrator:pw@localhost:5432/morbeez_e2e   # the owner
# and the API's own environment, pointed at the same database:
export APP_DATABASE_URL=postgres://morbeez_app:morbeez_app_ci@localhost:5432/morbeez_e2e
export APP_DB_PASSWORD=morbeez_app_ci JWT_SECRET=… FIELD_ENCRYPTION_KEY=… REDIS_URL=redis://localhost:6379
export LOGIN_ATTEMPTS_PER_IP_PER_MINUTE=100000   # the suites sign in hundreds of times
export API_BASE_URL=http://127.0.0.1:3000        # for the owner app's server
npx playwright-core install chromium             # once
pnpm --filter @morbeez/e2e e2e                   # every chain; or: … e2e finance
```

The runner prints each check, then one summary line per suite. It exits
non-zero if any suite printed a `FAIL` line or exited non-zero.

| Variable | Default | |
|---|---|---|
| `E2E_RESET_CMD` | `bash testing/e2e/reset-postgres.sh` | builds a fresh database before each chain |
| `E2E_API_CMD` | `node apps/backend/dist/src/main.js` | |
| `E2E_WEB_CMD` | `next start -p 3001` in the owner app | |
| `E2E_API_URL`, `E2E_WEB_URL` | `http://127.0.0.1:3000`, `:3001` | |
| `E2E_BROWSER_CHANNEL` | Playwright's Chromium | e.g. `msedge` to use an installed browser |
| `E2E_SHOTS_DIR` | `testing/e2e/.shots` | where the UI suites save screenshots, including on failure |

The suites connect to `E2E_DB_URL` as the superuser only to arrange time
(backdating an invoice so that it becomes overdue) and to read the ledger
directly. Everything else goes through the API or the owner app.

`account-ui-e2e` is not in either chain. It exercises the one-time password
that `provision-tenant` prints, and signup is off in production.
