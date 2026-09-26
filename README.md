# Morbeez ERP

A multi-tenant SaaS ERP for vegetable wholesalers. This is the production
monorepo. Most bounded contexts are still structure only, but the
foundation underneath all of them — configuration, database access,
logging, error handling — plus Users and Tenant (accounts, login,
sessions, roles/permissions, tenant isolation), the five master-data
contexts — Customers, Farmers, Products, Vehicles, Workforce (CRUD,
validation, audit history, optimistic-concurrency versioning) — and
Approvals (rules, monetary limits, role-based authorization, time-boxed
delegation — a deliberate extension beyond the original 14 bounded
contexts) are real, working implementations, not scaffolding. Every
folder below traces back to a governing design document.

## Layout

| Path | What it is | Governing document |
|---|---|---|
| `apps/backend` | NestJS modular monolith, 14 bounded contexts | System Architecture §02, Domain Model |
| `apps/owner-app` | React/Next.js web app — owners, ops, finance, accounting | Technology Stack §01 |
| `apps/driver-app` | Kotlin/Compose native Android — drivers | Technology Stack §02 |
| `packages/shared-types` | DTOs shared between backend and owner-app | Technology Stack §01, §03 |
| `packages/event-contracts` | Versioned event schemas | Event Catalog, System Architecture EVT.4 |
| `packages/ui-kit` | Shared design system for the owner app | System Architecture FE.3 |
| `packages/config` | Shared lint/TS config | Technical Constitution II.3 |
| `database/` | Migrations, seeds, per-context schema folders | Production Database |
| `infrastructure/` | Terraform — environments and modules | System Architecture §09, Technology Stack §05 |
| `docs/` | ADRs, runbooks, local copy points for governing docs | Technical Constitution IX |
| `testing/` | Cross-cutting e2e, load, and contract tests | Technical Constitution Article VI |

## Governing documents

This repository is built to satisfy a set of ratified design documents,
maintained as the team's shared Artifacts:

1. **Technical Constitution** — the binding engineering rules
2. **System Architecture** — frontend, backend, database, mobile, event,
   queue, notification, AI, and cloud design
3. **Technology Stack** — the final stack selection
4. **Domain Model** — the 14 bounded contexts
5. **Event Catalog** — the business events and their financial/inventory impact
6. **Accounting Engine** — double-entry rules
7. **Cost Allocation Engine** — trip cost and profitability formulas
8. **Inventory Engine** — lot tracking and stock states
9. **Workflow States** — the six lifecycle state machines
10. **Production Database** — the 67-table schema this repo implements

A change here that conflicts with one of these documents is a bug, not a
judgment call — amendments go through an ADR (`docs/adr/`) per Constitution
Article IX before the code or the document changes.

## Getting started

```
pnpm install
cp apps/backend/.env.example apps/backend/.env
pnpm docker:up          # Postgres + Redis, local containers only
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Requires Node 20+, pnpm, and Docker Desktop. `docker-compose.yml` runs
Postgres and Redis for local development only — production runs on managed
AWS services (Technology Stack, Section 05). Migrations run with
node-pg-migrate against `DATABASE_URL`, a privileged, migration-owning
role; the application itself connects with a second, separate
`APP_DATABASE_URL` credential (`morbeez_app`) that has DML-only grants and
is genuinely subject to Row-Level Security (`database/migrations/README.md`)
— tenant isolation depends on these being two different roles, not the
same one reused. Seeds insert synthetic dev fixtures only and refuse to
run against `NODE_ENV=production` (`database/seeds/README.md`,
Constitution VI.5).

CI runs lint, type-check, unit tests, a dedicated tenant-isolation
integration suite against a real Postgres (`apps/backend/test/integration`),
a migration up/down reversibility check, a Docker build validation, and a
dependency security scan on every PR (`.github/workflows/ci.yml`). CD
(`cd.yml`) is a foundation only — the build stage works; the deploy stage
is blocked on the Terraform in `infrastructure/terraform/environments/`
actually being applied.

Android Studio and a JDK are required separately for `apps/driver-app`.
