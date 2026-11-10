# Master Spec v3 — rule → test traceability

Every rule in the client's documents, and what proves it. Maintained with the
plan (`master-spec-v3-plan.md`): a phase is done only when each of its rows
here reads **Proven**. First written in P0 (9 Nov 2026).

- **Proven** — a test fails if the rule breaks. Evidence: e2e suite
  (`testing/e2e/suites/…-e2e.js`), backend unit spec (`…spec.ts`), or driver
  unit test (`…Test.kt`; screens by Paparazzi).
- **Gap → Pn** — not built, or built without proof; the phase that closes it.
- **Decision Dn** — waits on the client (plan §3).

Cites: **MS** `master-spec-v3.md`, **V1** `driver-app-v1-final.md`,
**DO** `daily-operations.md`, **FX** `client-update-12-fixes.md`.

## Master Spec v3

| Rule | Status | Evidence / closing phase |
|---|---|---|
| §1 Two apps, one backend, one database | Proven | Every chain runs both apps against one API and database |
| §2 Complete business process | Proven, in parts | The redesign chain end to end (procurement → orders → trips → stock → delivery → collections → handover); the gaps below |
| §3 Transport scaling: feeder, line-haul, last-mile, cross-dock comparison | Gap → P12 | — |
| §4 Owner footer and five-section menu, no duplicates | Gap → P2 | — |
| §5 Driver footer and menu | Proven in part | Footer and drawer: `driver-day-e2e`, Paparazzi `DriverDayScreenshots`. **Driver Cash** entry: Gap → P2 (D3) |
| §6 One task = one screen; known data automatic | Proven | Driver suites D1–D10; driver unit tests; Paparazzi screens |
| §7.1 Owner creates procurement | Proven | `redesign-procurement-e2e`, `procurement.service.spec` |
| §7.2 Owner creates order, sees AI prices, confirms price | Proven in part | Orders: `redesign-orders-e2e`, `orders.service.spec`. AI prices on the form: Gap → P3 |
| §7.3–7.4 Build and check the trip | Proven | `redesign-trips-e2e`; the Check (P1): `trip-checks.spec`, `trip-publish-e2e` |
| §7.5 Publish; driver sees nothing before | Proven | (P1) `trip-publish-e2e`: a draft is not in the driver's day, 404 by id, can't start; a failed check stops publishing; a change breaking a published trip is refused |
| §7.6–7.8 Monitor, approve, handle problems | Proven | `redesign-home-e2e`, `redesign-admin-e2e`, `delegation-e2e` |
| §7.9–7.10 Reconcile, close, expire driver access | Proven | `trip-handover-e2e`, `trip-closure.spec`; expiry (P1): `trip-publish-e2e` — a closed trip leaves the day, its live endpoints answer 409, its record keeps no phones, addresses, pins, QR or balances. The phone keeps only the day's trip (DRV.3, in code; field test 15) |
| §8 Driver SOP | Proven | `driver-day-e2e`, `farm-stop-e2e`, `delivery-stop-e2e`, `collections-return-e2e`, `backhaul-e2e`, `driver-records-e2e` |
| §9 Customer order with terms and credit | Proven | `redesign-orders-e2e`, `owner-modules-e2e`, `orders.service.spec` |
| §10 Procurement requirement from demand and stock | Proven in part | AI procurement: `ai-e2e`, `math.spec`. Planning view: Gap → P3 |
| §11 Procurement, agent, commission/KG | Proven in part | `redesign-procurement-e2e`; lifecycle DRAFT → … → SETTLED (P1): `procurement-lifecycle.spec`, `trip-publish-e2e` (confirmed → assigned → pickup → partially picked). Commission journal: Gap → P6 |
| §12 Farmer master | Proven in part | `redesign-parties-e2e`, `farmers.service.spec`. Payment terms, overdue, avg days: Gap → P6 |
| §13 Product master | Proven in part | `products.service.spec`, `chicken-eggs-finance-e2e` (kinds, pack size). Bag/crate weight: Gap → P3. No default price: D6 |
| §14 Price engine, trend ×3 | Gap → P3 | — |
| §15 Customer pricing | Proven in part | AI Pricing: `redesign-ai-e2e`. On the order form: Gap → P3 |
| §16 Minimum sustainable price; below → exception | Proven in part | Floor = cost + spoilage + delivery: `redesign-ai-e2e`, `math.spec`. Exception and override: Gap → P3 |
| §17 Customer economics, service minutes | Gap → P4 | — |
| §18 Routes | Proven | `redesign-trips-e2e` |
| §19 Trip contents | Proven | `redesign-trips-e2e`, `logistics.service.spec` |
| §20 Duration, service effort, delay classification | Gap → P4 | — |
| §21 Inventory: physical, reserved, available | Proven | `stock-by-the-kilo-e2e`, `lot-stock.service.spec`, `inventory.service.spec` |
| §22 KG/BAG entry; exact storage | Proven in part | Exact decimals throughout (D5); BAG at farm stops: `farm-stop-e2e`, `FarmLogicTest`. Elsewhere: Gap → P3 |
| §23 Lot traceability | Proven | `stock-by-the-kilo-e2e`, `delivery-stop-e2e` |
| §24 Shrinkage, rejection, damage, weight mismatch, quality loss separate | Proven in part | Shrinkage and post-acceptance rejection: `inventory.service.spec`, `ledger.service.spec`; farm rejections: `farm-stop-e2e`. Damage / weight mismatch / quality loss kinds: Gap → P8 |
| §25 Lot / event / individual accountability | Proven in part | Packer and loader credited once: `farm-stop-e2e`. Event variance: Gap → P7 |
| §26 Cross-dock | Proven in part | Lot transfers: `inventory.service.spec`. Driver step and comparison: Gap → P12 |
| §27 Customer delivery | Proven | `delivery-stop-e2e`, `delivery-stop.spec`, `DeliveryLogicTest` |
| §28 Customer dispute | Proven in part | Raise and pause: `collections-return-e2e`, `chicken-eggs-finance-e2e`. Classification, evidence, trace, responsibility: Gap → P8 |
| §29 Quality accountability | Gap → P8 | — |
| §30 Customer finance: terms, partial payments, FIFO, override | Proven in part | `finance-e2e` (allocations), `receivables.service.spec`, `finance-math.spec`. Bill-to-Bill: Gap → P6 |
| §31 Finance cost: internal from day 0; customer charge only past due, only if set | Proven in part | Cost of carrying receivables (rupee-days × rate ÷ 365): `math.spec` (`creditCost`, `profit`); customer charge from due date + grace, rate 0 = off: `receivables.service.spec`. **Default planning rate is 12%; MS §31 says 18%: Gap → P6**, with the explicit on/off switch |
| §32 Dispute finance | Proven in part | Pause on the disputed amount; 30 idle days → critical: `disputes.service.ts` + `chicken-eggs-finance-e2e`. **Catch-up from the original due date on rejection, accepted/rejected split: Gap → P6** |
| §33 Payment score 0–100; weighted customer score; provisional | Gap → P4 (D9) | Today's 0–5 score: `customer-insights.spec` |
| §34 Customer true cost | Proven in part | `math.spec` (profitability). Trip cost allocation: Gap → P5 (D1) |
| §35 Profitability hierarchy, net after finance | Proven in part | `redesign-money-e2e`, `reports.service.spec`. Allocated to orders: Gap → P5 |
| §36 Customer profitability display | Gap → P4, P5 | — |
| §37 Workforce engine and roles | Proven in part | `workforce-e2e`, `workforce-ui-e2e`, `workforce.service.spec`. Roles: Gap → P7 |
| §38–42 Pay structure, owner-configured money, growth, loader, packer | Proven in part | `payroll-math.spec`, `trip-incentives.spec`, `driver-earnings-e2e` (incl. conditions). ₹, slabs, KG/turnover growth, KPIs: Gap → P7 (D7) |
| §43 Workforce accounting | Proven | `workforce-e2e` (approve and pay post), `payroll-math.spec` |
| §44 Workforce dashboard per role | Gap → P7 | — |
| §45 Vehicle economics | Proven in part | `fleet-e2e`, `fleet-math.spec`. All-in ₹/KM, useful KM, residual: Gap → P11 |
| §46 Maintenance due by date or KM | Proven | `fleet-e2e` ("service due at 20,400 km is overdue at 20,450") |
| §47 Fixed assets, loans, EMI split, depreciation | Proven | `fleet-e2e`, `fleet-ui-e2e` |
| §48–52 Ledgers, GL, TB, P&L, BS, cash flow, controls, drill-down | Proven | `accounting-e2e`, `accounting-ui-e2e`, `ledger.service.spec`, `accounting.service.spec` |
| §53 Driver cash | Proven in part | Expected cash, UPI outside cash: `trip-handover-e2e`, `collections-return-e2e`. Running driver-cash view: Gap → P2; recovery priority: Gap → P6 |
| §54 WhatsApp, SMS, push | Proven in part | Inbound orders and the reply: `integrations-e2e`. Outbound messages, SMS, push: Gap → P10 (D8) |
| §55 AI modules | Proven in part | `ai-e2e`, `ai-ui-e2e`, `redesign-ai-e2e`, `integrations-e2e`, `math.spec`, `orders.spec`. Backhaul, collections priority, decision-log screen: Gap → P13 |
| §56 Exception flags | Proven in part | Alerts raised in `delivery-stop-e2e`, `collections-return-e2e`, `crates-e2e`, `backhaul-e2e`, `driver-requests-fastag-e2e`. The rest: Gap → P9 |
| §57 Approvals and overrides, audited | Proven in part | `redesign-admin-e2e`, `delegation-e2e`, `approvals.service.spec`, `delegations.service.spec`. Quality, responsibility, incentive, inventory types: Gap → P9 |
| §58 Driver security | Proven in part | Trip scope: `spot-e2e` ("can't sell from another driver's trip"), driver suites; encrypted DB, PIN: driver app; **one business can't see or touch another's rows, every table: `tenant-isolation-e2e`** (P0). Publish gate and expiry at close (P1): `trip-publish-e2e`; RLS on the identity link tables (P1): `tenant-isolation-e2e` |
| §59 Offline-first, idempotent events | Proven | `field-hardening-e2e`, `QueueLogicTest`, `idempotency.spec` |
| §60 Reconciliation: 12 areas, PASS / EXCEPTION / APPROVED | Proven | (P1) workforce, workload, vehicle/KM, exceptions, accounting added: `trip-closure.spec`, `trip-publish-e2e` (all pass on a sound trip, closed as a pass), `trip-handover-e2e` (12 areas), `backhaul-e2e` (13 with the backhaul) |
| §61 Database baseline | Proven | `docs/architecture/database-erd.md` (130 tables) |
| §62 ERD and indexing | Proven | ERD generated by `database/scripts/schema-report.js`; every business foreign key indexed (`20261111081000`); RLS on every tenant table (`20261111080000`), guarded by `tenant-isolation-e2e` |
| §63–65 Control model, economic model, principles | Follow the rows above | Each principle is the sum of its sections' rows |

## Driver App V1

| Rule | Status | Evidence / closing phase |
|---|---|---|
| §1 Bottom nav and drawer | Proven in part | `driver-day-e2e`, Paparazzi. Incentives and Driver Cash entries: Gap → P2 (D3) |
| §2 Start Day: vehicle, opening KM, GPS | Proven | `driver-day-e2e`, `DayLogicTest` (owner-published trip — D2) |
| §3 Dashboard, next action first, online/offline header | Proven | `driver-day-e2e`, `field-hardening-e2e`, Paparazzi |
| §4–9 Farmer stops: products, accept/reject with reasons, crew, sacks, weigh, load, complete | Proven | `farm-stop-e2e`, `farm-stop.spec`, `FarmLogicTest` |
| §10–15 Delivery: sequence, QR, quantities, photo, crates, stock = 0 | Proven | `delivery-stop-e2e`, `delivery-stop.spec`, `DeliveryLogicTest` |
| §16–17 Backhaul and its payment | Proven | `backhaul-e2e`, `backhaul.spec`, `BackhaulLogicTest` |
| §18–21 Collections: only this trip's delivered customers; partial; third party; dispute | Proven | `collections-return-e2e`, `CollectionsLogicTest` |
| §22 Return and closing KM | Proven | `collections-return-e2e` |
| §23 Cash handover; UPI outside cash | Proven | `trip-handover-e2e`, `collections-return-e2e` |
| §24–25 Incentives automatic; My Earnings | Proven | `driver-earnings-e2e`, `trip-incentives.spec`, `EarningsLogicTest` |
| §26 Trip summary | Proven | `driver-records-e2e`, `RecordsLogicTest` |
| §27 Final close check | Proven | `trip-handover-e2e`, `trip-publish-e2e`; the driver holds 3 sec to hand over and submit (P1, D4): Paparazzi screens |
| Field hardening: offline, safe confirmation, edit before complete, ETA, reasons | Proven | `field-hardening-e2e`, `QueueLogicTest`, `DayLogicTest` |

## The 12 fixes and smaller additions

| Fix | Status | Evidence / closing phase |
|---|---|---|
| FX 1 COGS at delivery | Proven | `receivables.service.spec`, `finance-e2e`, `stock-by-the-kilo-e2e` |
| FX 2 Journals | Proven in part | Shrinkage: `ledger.service.spec`; finance charges: `receivables.service.spec`; farmer advances: `payables.service.spec`, `finance-e2e`; vehicle disposal: `fleet-e2e`. **Credit notes, bad debt, agent commission: Gap → P6** |
| FX 3 Specific-lot costing | Proven | `stock-by-the-kilo-e2e`, `receivables.service.spec` |
| FX 4 Period close and lock | Proven in part | Close, lock, reopen: `accounting-e2e`, `accounting-ui-e2e`. The "5-step checklist": its steps are in the client's 15-part document — **D0** |
| FX 5 Tax layer | Proven in part | GST, HSN, e-invoice, TDS 194Q (farmers), 194C (hired vehicles): `tax-e2e`, `tax-ui-e2e`, `tax.builders.spec`, `fleet-e2e`. TDS on agent commission (194H): Gap → P6 |
| FX 6 Finance cost split | Proven in part | As MS §31 (the 18% default: P6) |
| FX 7 Standard cost floor; actual vs standard after the trip | Proven in part | Floor: `redesign-ai-e2e`. Post-trip variance: Gap → P5 |
| FX 8 Cost allocation rules | Gap → P5 (D1) | — |
| FX 9 Spot sales | Proven | `spot-e2e`, `spot-ui-e2e`, `spot-math.spec` |
| FX 10 Crate ledger | Proven | `crates-e2e`, `crates-ui-e2e`, `crates-math.spec` |
| FX 11 Delegation matrix | Proven | `delegation-e2e`, `delegations.service.spec` |
| FX 12 Trip states; dated master-data versions | Proven in part | Trip stages draft → published → on the road → submitted → closed: `trip-checks.spec` (`stageOf`), `trip-publish-e2e`; dated pay rates, tax rules, spot bands: `workforce-e2e`, `tax-e2e`, `spot-e2e`. Customer credit terms dated: Gap → P6 |
| Minimum-wage floor | Proven | `workforce-e2e` ("topped up to the ₹550 minimum") |
| Incentives on collected turnover | Proven | `driver-earnings-e2e` (collection incentive on what was collected) |
| Document expiry alerts, hired-vehicle costing | Proven | `fleet-e2e`, `fleet-ui-e2e` |
| UPI outside driver cash | Proven | `collections-return-e2e`, `trip-handover-e2e` |
| Suggested build order | Decision D0 | Not received |

## Daily operations

| Part | Status | Evidence / closing phase |
|---|---|---|
| Owner start of day (reconciliation, orders, stock, prices, credit, AI) | Proven in part | Home figures — sales, purchases, receivables, payables, trips, deliveries, alerts: `redesign-home-e2e`; AI: `redesign-ai-e2e`. Yesterday's reconciliation at a glance (P1): `trip-publish-e2e`. Prices and price movers: Gap → P3 |
| Owner during operations (trips, KG, stock, POD, collections, approvals) | Proven | `redesign-home-e2e`, `redesign-trips-e2e`, `redesign-admin-e2e` |
| Owner end of day (KG purchased vs received vs saleable, cash, costs, PASS/EXCEPTION) | Proven | `trip-handover-e2e`, `stock-by-the-kilo-e2e`, `trip-publish-e2e` (every area) |
| Driver: submit → reconcile → owner review → closed | Proven | `trip-handover-e2e`, `trip-publish-e2e` (P1: submitted, reviewed on every area, closed) |
| Division of responsibility (owner decides, driver records) | Proven | Driver suites refuse commercial decisions (disputes go to the owner, no write-off): `collections-return-e2e` |

## Calendar independence (P0)

The suites now pass on any date. Fixed in P0, found by running on 2 and 9 Nov
and by a simulated 1st of the month (the modules chain with the books closed
through yesterday before the workforce, fleet, crates and spot suites — a
stricter lock than any real month start):

| Suite | Was | Now |
|---|---|---|
| `workforce-e2e` | Pay period from the 1st; work dated 2–4 days ago fell outside it in a month's first days | Pay period = the last seven days |
| `fleet-e2e` | Fuel dated up to 6 days back posted before the books were reopened; hire bill for the 1st–15th of this month (in the future until the 15th); on the 1st, reopening reversed a closing entry that held an earlier suite's ₹800 late bill, and the expense check counted it | Books reopened before anything backdated; bill for the 1st–15th of last month; what the reopen moves is measured and left out of the checks |
| `fleet-ui-e2e` | Cost report on "this financial year" missed last month's data in April; it read the rows while the new range was still loading; the reminder setting reloaded the page before its save had landed (a known flake) | Preset checked, then the window starts two months back; it waits for the rows it reads; it waits for the save's answer before reloading |
| `workforce-ui-e2e`, `spot-e2e` | Failed only through the two above | — |
