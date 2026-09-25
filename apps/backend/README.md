# Morbeez Backend

NestJS modular monolith. Each folder under `src/modules/` is one bounded
context from the Domain Model — with its own module boundary, controller,
service, entities, and DTOs. Modules communicate through the event bus
(`src/infra/event-bus/`) or each other's public service exports, never by
reaching into another module's entities directly (Constitution I.3–I.4).

- `src/modules/` — the 14 bounded contexts (Tenant, Users, Customers, Farmers,
  Products, Orders, Procurement, Inventory, Logistics, Finance, Accounting,
  Workforce, Vehicles, AI)
- `src/common/` — cross-cutting decorators, guards, filters, middleware
- `src/infra/` — database, Redis, event bus, and outbox relay clients
- `worker/` — the separate background worker process (System Architecture, BE.5)
- `test/` — unit and integration tests (Constitution Article VI)

This is structure only — see `/docs/architecture` and `/docs/domain-model`
for the design this scaffold implements, and the Technical Constitution for
the rules every module follows.
