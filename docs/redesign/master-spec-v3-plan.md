# Master Spec v3 — gap analysis and implementation plan

Written 9 Nov 2026, against the code as it stands (owner Phases 0–9, driver
D0–D10, the client's answers of 2 Nov). It turns the client's four documents
into a checked list of what is built, what is partly built and what is
missing, then a phase-by-phase plan to close every gap without breaking what
works.

**Sources** (kept verbatim in `docs/reference/`; cited below as):

| Cite | Document |
|---|---|
| **MS §n** | `master-spec-v3.md` — Unified Final Master Specification, 65 sections |
| **DO** | `daily-operations.md` — Owner & Driver Daily Operations |
| **V1 §n** | `driver-app-v1-final.md` — Driver App V1 Final |
| **FX n** | `client-update-12-fixes.md` — the 12 fixes and smaller additions |

The governing engine documents (Accounting Engine, Cost Allocation Engine,
Inventory Engine, Workflow States, Driver App Architecture, AI System) stay
the detailed rules; read the relevant one before each phase and cite its rule
IDs in code, as before.

---

## 1. How every phase is built (the quality gates)

"Flawless" here means: nothing is called done until a test proves it, and
nothing that worked before stops working. Every phase follows these steps in
order, and its status row below is only marked done when all of them pass.

1. **Rules first.** List the phase's rules (MS/V1/FX numbers and engine rule
   IDs) at the top of the phase's section here, each with the test that will
   prove it. Ambiguity goes to §3 (decisions), not into code.
2. **Schema.** A new migration per phase — never an edit to one already
   committed (it has run on Neon). Backfills lift `FORCE ROW LEVEL SECURITY`
   around themselves. Tested down → up as the non-superuser `migrator` role
   on old-shaped rows, as for `20261110080000`.
3. **Backend.** Money and quantities exact (`numeric`, never floats; see
   decision D5). Every write in a tenant transaction, audited; every override
   carries user, reason and time (MS §57). Unit tests for every pure rule.
4. **Apps.** Owner and driver screens in the four languages (Malayalam,
   Kannada, Tamil drafts flagged for native review — the client arranges it).
   Driver actions queue offline with their own ids (MS §59).
5. **Tests.** Backend jest, owner lint + build, driver unit tests and
   Paparazzi screenshots, the phase's own e2e suite, then **every** e2e chain.
   A suite that fails for calendar reasons is fixed, not excused (P0).
6. **Docs.** This file's status row and the phase's evidence; `.env.example`
   if a key is added; runbook if deployment changes.
7. **Hand-off.** Report with screenshots. Before pushing: `pnpm db:migrate`
   on Neon. Nothing is committed without the user's say-so.

---

## 2. Where the code stands — gap analysis

Status: **Done** (built and tested), **Partial** (built in part — the gap is
named), **Missing**, **Verify** (believed built; P0 proves it with a test).

### 2.1 Architecture, navigation, SOP

| Spec | Requirement | Status | Evidence / gap | Phase |
|---|---|---|---|---|
| MS §1 | 2 apps, 1 backend, engines | Done | NestJS API, owner Next.js app, Kotlin driver app, one Postgres with RLS | — |
| MS §4 | Owner footer Dashboard · Procurement · Delivery · Trips | Missing | Footer is Home · Operations · (+) · Finance | P2 |
| MS §4 | Side menu BUSINESS / FINANCE / RESOURCES / CONTROL / SYSTEM, no duplicates | Partial | 7 groups, ~30 entries; Collections, Routes, Accounting, Tax, Crates, Spot sales, Delegation, Chat, Driver phones, Products, AI × 4 stand alone; no Help page | P2 |
| MS §5, V1 §1 | Driver footer + drawer | Partial | Footer done; drawer close to V1 §1; no **Driver Cash** (MS §5), no separate Incentives entry | P2 |
| MS §6 | One task = one screen; known info automatic | Done | Driver D1–D10 | — |
| MS §7.5, DO | Owner **publishes** a trip; driver sees it only after | Done (P1) | Check & publish; a draft is invisible to its driver (`trip-publish-e2e`) | — |
| MS §8, V1 | Driver SOP, golden rules | Done | D1–D10, D8 hardening | — |
| DO | Driver **submits** → ERP reconciles → owner reviews → closed | Done (P1) | "Hold 3 sec to hand over and submit the trip"; the owner closes on every area | — |

### 2.2 Demand, procurement, products, prices

| Spec | Requirement | Status | Evidence / gap | Phase |
|---|---|---|---|---|
| MS §9 | Order with price, terms, credit | Done | Delivery orders, credit check | — |
| MS §10 | Procurement requirement from demand + stock | Partial | AI procurement suggestions; no "required KG / shortage" planning view | P3 |
| MS §11 | Procurement with optional agent, commission/KG | Partial | Agents and commission stored; the DRAFT → … → SETTLED lifecycle shown (P1); **no journal for commission** (FX 2) | P6 |
| MS §12 | Farmer master: terms, bank/UPI, history, overdue, avg payment days | Partial | Bank/UPI, owed/paid/advance done; **no farmer payment terms** (Immediate, Bill-to-Bill, Net 3–60, Custom), no avg payment days or overdue | P6 |
| MS §13 | Product: base unit, KG/BAG, bag weight, crate weight; no default prices | Partial | Units and kinds done; bag weight only per farm stop; an optional base price still exists | P3 |
| MS §14 | Weighted averages; trend in Product, Dashboard movers, Reports | Missing | Only AI Pricing's 14-day range | P3 |
| MS §15 | Order shows AI customer-specific and AI average price | Partial | AI Pricing per product; order priced as last charged; neither AI price on the order form | P3 |
| MS §16, FX 7 | Floor = standard cost from rolling 30 days; selling below → exception, override audited | Partial | Floor computed (`ai/math/pricing.ts`); **no warning or override at order time** | P3 |
| FX 7 | After the trip, actual cost vs standard | Missing | — | P5 |
| MS §22, V1 §7 | Enter KG or BAG; exact storage | Partial | Exact `numeric` storage; BAG only at farm stops (decision D5 on grams/paise) | P3 |

### 2.3 Trips, inventory, delivery, service effort

| Spec | Requirement | Status | Evidence / gap | Phase |
|---|---|---|---|---|
| MS §18–19, FX 12 | Routes; trip with crew, stops, money; explicit states | Done | `routes-and-trips`; planned → in_progress → completed → reconciled, on_hold, cancelled | — |
| MS §20 | Expected vs actual duration; per stop arrival, service start/complete, departure, waiting, unloading, weighing, collection; delay classified | Missing | Arrival only | P4 |
| MS §21, §23, FX 3 | Physical / reserved / available; lot traceability; specific-lot cost | Done | D0 lot balances, `lot_allocation`, COGS by lot | — |
| MS §24 | Shrinkage, rejection, damage, weight mismatch, quality loss separate | Partial | (P0) Shrinkage and post-acceptance rejection are their own movement kinds, farm rejections have reasons; **damage, weight mismatch and quality loss are not separate kinds** | P8 |
| MS §25 | Lot / event / individual accountability | Partial | Packer and loader credited; event-level variance not reported | P7 |
| MS §26, §3 | Cross-dock; feeder / line-haul / last-mile | Partial | Lot transfers exist; no cross-dock step in the driver app, no trip types, no comparison | P12 |
| MS §27, V1 §10–15 | Delivery, QR, POD, crates, stock = 0 | Done | D3 | — |
| V1 §16–17 | Backhaul | Done | D5 | — |
| V1 §18–21 | Collections only for customers delivered on the trip | Done | D4 | — |
| V1 §22–23, MS §53 | Return KM; cash handover; UPI not in cash | Done | D4, D10 | — |
| MS §53 | Driver cash ledger (opening + collections + advances − expenses − settlements − deposits); recovery priority | Partial | Expected cash at handover; no running driver-cash view; priority rule unverified | P2, P6 |
| MS §60 | Reconciliation areas: procurement, inventory, delivery, collection, expenses, workforce, workload, cash, vehicle/KM, backhaul, exceptions, accounting | Done (P1) | Workforce, workload, vehicle/KM, exceptions and accounting added — 12 areas, 13 with a backhaul | — |

### 2.4 Customers, finance, accounting

| Spec | Requirement | Status | Evidence / gap | Phase |
|---|---|---|---|---|
| MS §17, §36 | Customer resource profile (30-day service minutes, waiting…); economic efficiency; profitability display | Missing | Needs P4 data | P4 |
| MS §28–29 | Dispute reasons, evidence, lot/workforce trace, responsibility, one penalty, complaint ≠ deduction | Partial | Invoice disputes with finance pause; no quality classification, trace or responsibility | P8 |
| MS §30 | Terms Immediate, Bill-to-Bill, Net, Custom; FIFO; owner override | Partial | Days-based terms, FIFO; **no Bill-to-Bill**; override to verify | P6 |
| MS §31, FX 6 | Internal cost of capital from day 0 (18%); customer charge only past due, only if on | Partial | (P0) Carrying cost tested (`math.spec` `creditCost`); customer charge rate defaults to 0 = off. **Default planning rate is 12%, the spec says 18%**; an explicit on/off switch to add | P6 |
| MS §32 | Dispute pauses accrual; 30 days idle → resumes + critical; rejected → accrues from the original due date; partial → accepted part stops, rejected part accrues | Partial | (P0) Pause and the 30-day critical alert done. **When a dispute closes, the paused interest is never caught up from the original due date, and there is no accepted / rejected split** (a close is "resolved" or "withdrawn" with words) | P6 |
| MS §33 | Payment score 0–100; customer score 35/25/15/15/10; provisional | Missing | Current score is 0–5 from on-time share | P4 |
| MS §34–35 | True cost; contribution hierarchy Business → Route → Trip → Vehicle → Product → Customer/Order; net after finance | Partial | AI profitability, Profit & Insights, reports; trip costs not allocated to orders | P5 |
| FX 8 | Cost allocation rules (fuel, vehicle, labour spread to orders, each rupee once) | Partial | Needs decision D1 (KG vs service time) | P5 |
| FX 1–3 | COGS at delivery, by lot | Done | `receivables.service.ts` (`cogs_recognized`) | — |
| FX 2 | Journals: shrinkage ✓, finance charge ✓, vehicle disposal ✓, farmer advance ✓, **bad debt ✗**, **credit note ✗**, **agent commission ✗** | Partial | (P0) Farmer advances drawn down oldest first (`payables.service.ts` ADV.2, tested); only *inventory* write-offs exist — no receivable write-off | P6 |
| FX 4 | Period close, lock, 5-step checklist | Partial | (P0) Close, lock, reopen tested (`accounting-e2e`); the five steps are in the client's 15-part document we haven't received | D0 |
| FX 5 | GST incl. exempt, HSN, TDS farmer/agent, e-invoice ready | Partial | (P0) GST, HSN, e-invoice, TDS 194Q on farmer purchases and 194C on hired vehicles tested; **TDS 194H on agent commission missing** | P6 |
| FX 12 | Rate and terms changes as dated versions | Partial | Pay rates, tax rules, spot bands, fleet docs dated; **customer credit terms overwrite** | P6 |
| MS §43, §47–52 | Workforce accounting, assets, loans, GL, TB, P&L, BS, cash flow, drill-down | Done | Accounting, fleet and payroll modules | — |

### 2.5 Workforce, vehicles, AI, control, communication, security

| Spec | Requirement | Status | Evidence / gap | Phase |
|---|---|---|---|---|
| MS §37 | Roles driver, assistant, loader, packer, unloader, sorter, temporary, casual; pool → assignment → settlement | Partial | Roles driver/warehouse/procurement/finance/other; work kinds trip/warehouse/loading/grading/market | P7 |
| MS §38–40 | Base, KG incentive, KPI, monthly productivity, retention, quality; ₹ / % / slabs / eligibility / dates / caps; uncapped growth: new customer, turnover, KG; no gaming | Partial | Driver: 10 incentives as % with conditions (2 Nov); wage rules per trip / unit / attendance; min-wage floor. Missing ₹ and slabs, KG and turnover growth, monthly and retention, caps | P7 |
| MS §41–42, §44 | Loader and packer KPIs with weights; one base when one person does both; dashboard per role | Partial | One base for packer+loader done (D2); KPIs and role dashboards missing | P7 |
| MS §45 | Component vs all-in ₹/KM; useful life/KM; residual | Partial | Component costs and straight-line depreciation; no all-in mode, useful KM or residual | P11 |
| MS §46 | Maintenance due by date or KM | Done | `next_due_date`, `next_due_km` | — |
| MS §54 | WhatsApp: orders ✓; receipts, delivery confirmations, reminders, payment links, dispute updates; SMS fallback; push | Partial | Inbound orders + reply (Sarvam); nothing outbound beyond the reply; no SMS, no push | P10 |
| MS §55 | AI Orders, Procurement, Logistics, Collections, Backhaul, Profitability, Exceptions, Decision log | Partial | Orders, pricing, procurement, route, load, customer terms, exceptions, calls; no backhaul or collections-priority producer; decisions stored, no decision-log screen | P13 |
| MS §56 | 25 exception flags | Partial | 14 alert kinds + approvals inbox; missing e.g. below-floor, low-margin, missing POD, route delay, duplicate/impossible KG, excess incentive, attendance anomaly, accounting imbalance | P9 |
| MS §57 | Approvals incl. quality decision, workforce responsibility, incentive override, inventory adjustment | Partial | Inbox + delegation matrix (FX 11 done); the four named types missing | P9 |
| MS §58 | PIN, device binding, trip scope, encryption, no export, expiring access, remote purge, nothing before publish | Done (P1) | Publish gate; access ends at the close (live endpoints 409, the record without phones, addresses, pins, QR or balances); the phone keeps only the day's trip (DRV.3; field test 15) | — |
| MS §59 | Offline queue, idempotent client ids, no last-write-wins for stock/money | Done | D8 | — |
| MS §61–62 | ERD and indexing as developer deliverables | Done (P0) | `docs/architecture/database-erd.md`, generated by `database/scripts/schema-report.js`; 68 business foreign keys indexed (`20261111081000`) | — |
| Constitution, MS §58 | Row-level security on every table of a business's data | Done (P0) | Seven tables had none (order and purchase-order lines, trip stops, stop photos, PODs, trip expenses, reconciliations): `20261111080000` adds tenant, trigger and forced RLS; `tenant-isolation-e2e` proves isolation across all 125 tenant tables and guards later migrations. `identity.user_role` and `identity.role_permission` followed in P1 (`20261112081000`) | — |
| FX 9–11 | Spot sales, crate ledger, delegation | Done | `spot-sales`, `crates`, delegation modules | — |
| FX small | Min wage, incentives on collected turnover, document expiry, hired-vehicle cost, UPI outside cash | Done | Payroll, D7, fleet, D4 | — |

---

## 3. Decisions to settle with the client (before the phase that needs them)

Each has our recommendation; the phase does not start until it's answered.

| # | Question | Recommendation | Needed by |
|---|---|---|---|
| D0 | The client wrote "I regrouped the 65 sections into 15 parts … added 12 fixes … and a suggested build order", but only the summary and the 65-section version reached us. | Ask for the 15-part document and its build order, and diff it against this plan before P3. | P3 |
| D1 | **The client's open question:** how trip costs split between KG delivered and customer service time. | Two pools. **Load pool** (loading/packing labour, packaging, shrinkage, rejection) by KG delivered. **Running pool** (fuel, tolls, vehicle ₹/KM, crew time) split by a tenant setting, default **50% by KG, 50% by verified service minutes**, falling back to 100% KG until a customer has 30 days of service-time data. Driver base pay is never allocated (MS §34). | P5 |
| D2 | V1 §2 has the driver choose a vehicle and the backend create the trip; MS §7–8 and DO have the owner build and publish it. | Keep the owner-published trip (what is built); the driver confirms the vehicle shown. | P1 |
| D3 | Drawer: MS §5 (Trip History · Earnings · Settlements · Driver Cash · Sync · Help · Profile · Language) vs V1 §1 (Operations · My · Trips · Control · Account). | V1 §1 groups, plus **Driver Cash** under My and **Incentives** as its own entry. | P2 |
| D4 | Who closes the trip: V1 §27 "Hold 3 sec → Close trip" (driver) vs DO (driver submits, owner closes). | Driver **Submits** (hold 3 sec); owner reviews and closes, as built. | P1 |
| D5 | MS §22: integer grams and paise. | Keep exact decimals (`numeric(12,3)` kg = grams exactly; `numeric(12,2)` = paise exactly): same precision, no floats, no rewrite of 80 migrations. Confirm in writing. | P0 |
| D6 | MS §13: no default prices on products; today an optional base price exists as a reference. | Remove it from the product form and from pricing; orders keep pricing from the last actual price. | P3 |
| D7 | MS §39: which incentives use ₹, %, slabs and caps by default; MS §40 says growth incentives are uncapped. | All configurable, all off by default (as built); caps only on non-growth incentives. | P7 |
| D8 | MS §54: business-initiated WhatsApp needs Meta-approved templates and a cost per conversation. | The client approves template wording; Morbeez's Meta account (as agreed 2 Nov) submits them. | P10 |
| D9 | MS §33: weights for "Profitability" and "Order quality" need definitions. | Profitability = contribution margin percentile among active customers; order quality = share of orders delivered without dispute or short delivery. | P4 |

---

## 4. The phases

Order chosen for dependency and risk: correctness and control first (P0–P1),
then the commercial core the client called critical (P3, P6, P4, P5), then
workforce and accountability (P7–P9), then breadth (P2 navigation, P10–P13),
then sign-off. P2 can run alongside P3 once P1 is green.

### P0 — Baseline: prove what's "Done", make the test suite trustworthy
- Fix the five modules-chain suites that fail in the first days of a month
  (`workforce-e2e`, `workforce-ui-e2e`, `fleet-e2e`, `fleet-ui-e2e`, `spot-e2e`):
  date their work inside the open period whatever today is.
- A **traceability matrix** (`docs/redesign/master-spec-v3-trace.md`): every
  MS/V1/FX rule → the test that proves it (unit or e2e) → status. Each
  "Verify" row above gets a test or becomes a gap.
- Write tests for: shrinkage vs weight mismatch vs quality loss kinds (MS §24);
  partial-acceptance dispute arithmetic (MS §32); the 5-step close (FX 4); TDS
  on farmer payments (FX 5); bad debt and farmer advance journals (FX 2);
  allocation override (MS §30).
- ERD generated from the live schema (tables, keys, relations), plus an index
  review of the high-frequency queries MS §62 lists.
- **Done when:** all 44 suites green on any date; every Verify row resolved.

### P1 — Control flow: publish, submit, reconcile everything (MS §7, §58, §60; DO; D2, D4)

Rules and their proof (written before the code, 9 Nov 2026):

| # | Rule | Built as | Proved by |
|---|---|---|---|
| R1 | Owner checks, then publishes; the driver sees nothing of an unpublished trip; a change to a published trip takes it back to the owner (MS §7.4–7.5, §58; DO) | `trip.published_at`/`published_by` (status stays `planned`; the API's `stage`: draft → published → on the road → submitted → closed). `GET …/trips/:id/check`, `POST …/trips/:id/publish` refused while a check fails. Unpublished: not in the driver's day, its trip endpoints 404, can't start. A published trip stays published when the owner changes it (the change reaches the phone at its next sync, as before); a change that would fail a hard check (vehicle unfit, over capacity, unconfirmed order, past date) is refused. Publishing checks the version the owner looked at, without bumping it. Existing trips count as published | `trip-checks.spec.ts`; `trip-publish-e2e.js` |
| R2 | The driver **submits** (hold 3 sec); the owner closes (V1 §27, DO; D4) | Driver app wording and a 3-second hold on the handover | Paparazzi screens; `trip-handover-e2e` unchanged |
| R3 | Twelve close areas, each PASS / EXCEPTION, approved with a reason (MS §60) | `checklistOf` adds **workforce** (the driver's work recorded, a pay rate in force), **workload** (each completed stop's arrival and completion times), **vehicle** (opening and closing KM; KM and fuel plausible), **exceptions** (no open alert, dispute or request on the trip) and **accounting** (the trip's journals balance and match its collections, expenses and handover) | `trip-closure.spec.ts`; `trip-publish-e2e.js` |
| R4 | Driver access ends at close; the phone keeps nothing of a closed trip (MS §7.10, §58) | A closed trip leaves the driver's day; its live endpoints answer 409 "Trip … is closed"; its summary, incentives and handover stay (the driver's own record). The phone already keeps only the day's trip (DRV.3) | `trip-publish-e2e.js` |
| R5 | Procurement lifecycle DRAFT → CONFIRMED → ASSIGNED → PICKUP → PARTIALLY PICKED → PICKED UP → SETTLED (MS §11) | Derived, never stored: from the order, its pickup and trip stop, what was received, and the farmer's settlement | `procurement-lifecycle.spec.ts`; `trip-publish-e2e.js` |
| R6 | Row-level security on `identity.user_role` and `identity.role_permission` | tenant_id, the P0 trigger (from the role), forced RLS | `tenant-isolation-e2e` (the list of tables without a tenant shrinks to the three global ones) |
| R7 | Home: yesterday's reconciliation at a glance (DO) | Trips closed yesterday: pass / approved exception, cash short or over, deliveries short | `redesign-home-e2e` |

- Trip **published** step: `planned → published → in_progress …`. The driver's
  day, stops, customers and farmers are invisible before publication; the
  owner's Check screen (capacity, quantities, collections, route) precedes
  Publish (MS §7.4–7.5). Editing a published trip un-publishes it with notice
  to the driver.
- Driver **Submit trip** (hold 3 sec) replaces "hand over" wording; owner
  closes.
- Reconciliation adds **workforce** (work events generated, incentives
  calculated), **workload** (service-effort data present, once P4 lands),
  **vehicle/KM** (opening/closing KM, fuel vs distance), **exceptions** (none
  open on the trip, or approved) and **accounting** (the trip's journals
  balance) — each PASS / EXCEPTION / APPROVED EXCEPTION; nothing closes
  silently.
- Driver access to a trip **expires at close**; its data is purged from the
  phone after the last sync (MS §58).
- Procurement lifecycle shown as MS §11 states, derived from the order, its
  pickup and its settlement (no second source of truth).
- Row-level security for `identity.user_role` and `identity.role_permission`
  (from P0): sign-in reads them before a tenant is chosen, so through a
  definer lookup, as the webhooks do.
- Home: yesterday's reconciliation at a glance — trips closed PASS /
  EXCEPTION / APPROVED, cash and KG differences (DO, owner start of day).
- **Done when:** a driver sees nothing of an unpublished trip (API and app);
  a trip cannot close with any of the 12 areas unchecked; e2e covers each.

### P2 — Navigation as the spec draws it (MS §4–5; D3)
- Owner footer Dashboard · Procurement · Delivery · Trips. Side menu:
  BUSINESS (Customers, Farmers, Inventory), FINANCE (Finance, Profit),
  RESOURCES (Workforce, Vehicles), CONTROL (AI, Approvals & Exceptions,
  Reports), SYSTEM (Settings, Profile, Help).
- Folded in, nothing lost: Collections → Finance and Delivery; Accounting and
  Tax → Finance; Routes, Chat, Driver phones → Trips; Crates → Inventory;
  Spot sales → Delivery and Approvals; Delegation → Workforce; Products →
  Settings; Alerts → bell + Approvals & Exceptions; the four AI pages → AI.
  Old URLs redirect.
- Owner **Help** page; driver **Driver Cash** screen (MS §53 formula,
  read-only) and **Incentives** entry.
- **Done when:** every old route still reaches its screen; screenshots of
  both menus; no e2e selector broken.

### P3 — Prices and commercial control (MS §10, §13–16, §22; FX 7; D6)
- Price engine: weighted average Σ(price × KG) ÷ ΣKG per product, day,
  route, farmer, customer. **Product → Trend** (30 days default; purchase /
  selling / both; averages, spread, volume), **Dashboard → Price movers**
  (top 5 day-over-day), **Reports → Price trends** (product, route, market,
  farmer, customer, date).
- Order form shows the **AI customer-specific price** and **AI average
  price** next to the price the owner confirms.
- Selling below the **floor** raises a below-floor exception; confirming needs
  an override reason, audited (MS §16, §57). Low-margin flag likewise.
- Product master: KG per bag, bag weight, optional crate weight; KG/BAG entry
  on orders and deliveries, converted exactly. Base price removed (D6).
- Procurement planning view: demand + expected demand − available stock →
  required KG and shortage per product (MS §10).
- **Done when:** weighted averages match a hand calculation in tests; a
  below-floor order cannot be placed without a reason; BAG entries round-trip
  exactly.

### P4 — Service effort and customer economics (MS §17, §20, §33, §36; D9)
- Driver app records, per stop: arrival (exists), service start, service
  complete, departure, and waiting / unloading / weighing / collection
  minutes where they apply; a delay is classified (customer waiting,
  procurement waiting, traffic, vehicle, driver, additional delivery, other).
  Never assumed customer-caused (MS §20). Offline-safe, with phone times.
- Trip expected vs actual duration and variance.
- Rolling 30-day customer resource profile; **Customer Economic Efficiency**
  as an AI input, never a service rule (MS §17).
- **Payment score 0–100** and **customer score** 35/25/15/15/10, provisional
  for new customers, one incident not distorting it (MS §33).
- Customer profitability display per MS §36.
- **Done when:** a delivery carries its five timestamps; scores match the
  documented formula in unit tests; new customers show "Provisional".

### P5 — Cost allocation, true cost, standard vs actual (MS §34–35; FX 7–8; D1)
- Cost pools and allocation per D1, every rupee allocated once (Cost
  Allocation Engine rules); driver base pay never allocated; verified
  customer-specific workload incentive may be.
- True cost and contribution per order, customer, product, trip, vehicle,
  route, business; net contribution after finance cost.
- After each trip: actual cost per KG vs the standard cost floor, the
  variance shown on the trip and fed to AI Pricing.
- **Done when:** the sum of allocated costs equals the trip's actual costs to
  the paisa in tests; the variance appears on closed trips.

### P6 — Finance completions (MS §11–12, §30–31, §53; FX 2, 5, 6, 12)
- Farmer payment terms (Immediate, Bill-to-Bill, Net 3/7/10/15/20/30/45/60,
  Custom), due dates on payables, farmer overdue and average payment days.
- Customer **Bill-to-Bill** term (the previous bill falls due at the next
  delivery).
- **Agent commission** accrued on verified KG (Dr procurement cost, Cr agent
  payable), paid like a payable, TDS where it applies.
- **Credit notes** as documents (from an accepted dispute or a quality
  decision) with their journal; no automatic write-off (MS §32).
- **Dispute finance (from P0):** a close records the accepted and rejected
  amounts; the accepted part stops for good (its credit note), the rejected
  part's paused interest is caught up from the original due date.
- **Bad debt:** writing off a receivable, owner-approved, with its journal
  (Dr bad debts, Cr receivable) — never automatic.
- **TDS 194H** on agent commission (from P0).
- Customer finance charge: explicit on/off per customer (off by default).
- Default internal cost of capital **18%** a year (MS §31; today 12%); a
  business that never changed it moves to 18%, one that chose a rate keeps it.
- Customer credit terms as dated versions, not overwrites.
- Driver cash recovery priority (approved expenses → settlements → advance
  recovery) checked in tests.
- **Done when:** each journal in FX 2 has a test that balances; trial balance
  stays even across the e2e chains.

### P7 — Workforce engine v2 (MS §25, §37–44; D7)
- Roles: driver, assistant, loader, packer, unloader, sorter, temporary
  helper, casual (no login for casual). Work events per role.
- Pay components kept separate: base; KG incentive; KPI; monthly productivity;
  consistency / retention; quality accountability (variable only).
- Owner-configured money: ₹, %, slabs, eligibility, effective dates,
  conditions, caps (not on growth incentives).
- Driver growth: new customer, customer turnover, customer KG — measured
  separately, uncapped, duplicate or split activity excluded.
- Loader and packer KPIs with the spec's weights; one person doing both = one
  base, no double KG pay.
- Workforce dashboard per role (MS §44); incentive journals (MS §43).
- **Done when:** each role's pay recomputes exactly from its work events in
  tests; gaming cases (duplicate KG, split deliveries) earn nothing.

### P8 — Quality accountability (MS §24, §28–29)
- Loss kinds kept apart (from P0): shrinkage, rejection, damage, weight
  mismatch, quality loss — each its own movement kind and journal line.
- Dispute classification (rotten, damaged, undersize, mixed quality, poor
  freshness, other), evidence bundle (pickup, packing, loading, delivery
  photos, POD, weight, GPS, lot, statements), lot and workforce trace.
- Owner assigns responsibility (shared allowed, with reason); one penalty per
  dispute; affects variable incentive only; compensation goes to customer
  true cost / trip profitability; a complaint alone never deducts.
- **Done when:** a resolved dispute shows its trace and responsibility, and
  payroll reflects at most one adjustment for it.

### P9 — Exceptions and approvals complete (MS §56–57)
- Every MS §56 flag raised by a rule with a test, deduplicated, routed to
  Approvals & Exceptions; MS §57 approval types added (quality decision,
  workforce responsibility, incentive override, inventory adjustment) under
  the delegation matrix.
- **Done when:** each flag has a test that raises it and one that doesn't.

### P10 — Communication (MS §54; D8)
- WhatsApp templates in the customer's language: receipt, delivery
  confirmation, payment reminder, overdue reminder, payment link, dispute
  update. SMS fallback. Push notifications to owner and driver. A failed
  message never blocks accounting (outbox, retried).
- **Done when:** each message type goes through a stand-in in e2e, with the
  fallback path tested.

### P11 — Vehicle economics (MS §45)
- Component mode vs all-in ₹/KM mode, never both; useful life, useful KM,
  residual value; true cost/KM per vehicle.
- **Done when:** switching modes changes cost/KM without double counting, in
  tests.

### P12 — Transport scaling and cross-dock (MS §3, §26)
- Trip types feeder, line-haul, last-mile; a cross-dock transfer step in the
  driver app with lot continuity and transfer variance; AI Logistics compares
  direct, consolidated and cross-dock on utilisation, cost/KG and
  contribution per vehicle-day.
- **Done when:** a lot keeps its trace across a transfer; variance is
  reconciled on both trips.

### P13 — AI completion (MS §55)
- AI Collections (payment priority and exposure), AI Backhaul (return-load
  opportunities), AI Profitability views, and an AI Decision Log screen over
  the recorded recommendations and owner decisions.

### P14 — Sign-off
- Final ERD and indexes; native-language review incorporated; field test on a
  real phone (`driver-app-field-test.md`); client acceptance against the
  traceability matrix.

---

## 5. Status

| Phase | State | Evidence |
|---|---|---|
| P0 Baseline | Done (9 Nov 2026) | Traceability matrix `master-spec-v3-trace.md` (every Verify row resolved: 3 proven, 5 new gaps placed in P6/P8, FX 4 to D0). Suites date-proof (`workforce-e2e`, `fleet-e2e`, `fleet-ui-e2e`; the reminder-setting flake fixed); proven on a simulated 1st of the month. ERD and index review `docs/architecture/database-erd.md` from `database/scripts/schema-report.js`. Migrations `20261111080000_tenant-on-line-and-stop-tables.js` (tenant + trigger + forced RLS on 7 tables that had none) and `20261111081000_business-foreign-key-indexes.js` (68 indexes), both tested down and up as `migrator` on real data. New `tenant-isolation-e2e.js` 8/8 (fails without the migration). All 45 suites green; backend 634/634 |
| P1 Control flow | Done (10 Nov 2026) | R1–R7 above. Migrations `20261112080000_trip-publish.js` (published_at/by; existing trips published by whoever made them) and `20261112081000_identity-link-tables-rls.js` (tenant + trigger + forced RLS on user_role and role_permission), both tested down and up as `migrator`, the backfills on real rows. `GET …/trips/:id/check`, `POST …/trips/:id/publish`; trip `stage` on records and board cards; the close's twelve areas (13 with a backhaul); driver access ends at the close (record-only summary, incentives, handover); procurement `lifecycle`; Home `yesterday`. Owner app: Check & publish, stage badges, the five new close areas, "Where it stands" on a purchase, Yesterday on Home. Driver app: "Hold 3 sec to hand over and submit the trip", publish wording; the greeting hour pinned in screenshots. Suites: new `trip-publish-e2e.js` 33/33; 37 publish calls in 22 suites; arrivals and odometer readings where suites closed trips as a pass; `owner-modules-e2e` publishes from the page. All 46 suites green; backend 651/651; `trip-checks.spec`, `procurement-lifecycle.spec`, 5 more in `trip-closure.spec` (and `trimQty` no longer turns 48620 into 4862); driver unit tests and Paparazzi verified |
| P2 Navigation | Not started | — |
| P3 Prices & commercial control | Not started | Needs D0, D6 |
| P4 Service effort & customer economics | Not started | Needs D9 |
| P5 Cost allocation & true cost | Not started | Needs D1 |
| P6 Finance completions | Not started | — |
| P7 Workforce engine v2 | Not started | Needs D7 |
| P8 Quality accountability | Not started | — |
| P9 Exceptions & approvals | Not started | — |
| P10 Communication | Not started | Needs D8 |
| P11 Vehicle economics | Not started | — |
| P12 Transport scaling & cross-dock | Not started | — |
| P13 AI completion | Not started | — |
| P14 Sign-off | Not started | — |
