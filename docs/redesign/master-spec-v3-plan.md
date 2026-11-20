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
| MS §11 | Procurement with optional agent, commission/KG | Done (P6) | Lifecycle shown (P1); commission earned at grading — verified kg × commission/kg, Dr Agent commission / Cr Accounts payable — agents — and paid in full, no TDS (the client, 10 Nov 2026) (`finance-p6-e2e`) | — |
| MS §12 | Farmer master: terms, bank/UPI, history, overdue, avg payment days | Done (P6) | Immediate, Bill-to-Bill, Net 3/7/10/15/20/30/45/60, Custom; each payable due by the terms it accrued under; overdue and average payment days on the profile (`finance-p6-e2e`) | — |
| MS §13 | Product: base unit, KG/BAG, bag weight, crate weight; no default prices | Partial | Units and kinds done; bag weight only per farm stop; an optional base price still exists | P3 |
| MS §14 | Weighted averages; trend in Product, Dashboard movers, Reports | Missing | Only AI Pricing's 14-day range | P3 |
| MS §15 | Order shows AI customer-specific and AI average price | Partial | AI Pricing per product; order priced as last charged; neither AI price on the order form | P3 |
| MS §16, FX 7 | Floor = standard cost from rolling 30 days; selling below → exception, override audited | Partial | Floor computed (`ai/math/pricing.ts`); **no warning or override at order time** | P3 |
| FX 7 | After the trip, actual cost vs standard | Done (P5) | Rule C5: delivery cost per KG on the closed trip against the route's (else the business's) last 30 days, the variance on the trip panel | P5 |
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
| MS §53 | Driver cash ledger (opening + collections + advances − expenses − settlements − deposits); recovery priority | Partial | Priority verified (P6, F9): approved expenses come off the handover first (`trip-closure.spec`), the settlement is paid next and an advance is recovered only from what is left, never below zero, capped by the owner (`payroll-math.spec`). **No running driver-cash view** | P2 |
| MS §60 | Reconciliation areas: procurement, inventory, delivery, collection, expenses, workforce, workload, cash, vehicle/KM, backhaul, exceptions, accounting | Done (P1) | Workforce, workload, vehicle/KM, exceptions and accounting added — 12 areas, 13 with a backhaul | — |

### 2.4 Customers, finance, accounting

| Spec | Requirement | Status | Evidence / gap | Phase |
|---|---|---|---|---|
| MS §17, §36 | Customer resource profile (30-day service minutes, waiting…); economic efficiency; profitability display | Missing | Needs P4 data | P4 |
| MS §28–29 | Dispute reasons, evidence, lot/workforce trace, responsibility, one penalty, complaint ≠ deduction | Partial | Invoice disputes with finance pause; no quality classification, trace or responsibility | P8 |
| MS §30 | Terms Immediate, Bill-to-Bill, Net, Custom; FIFO; owner override | Done (P6) | Days-based terms (0 = Immediate), Bill-to-Bill (due at the next bill, or at the backstop), FIFO, explicit allocations as the owner's override; finance charge ON/OFF (`finance-p6-e2e`) | — |
| MS §31, FX 6 | Internal cost of capital from day 0 (18%); customer charge only past due, only if on | Done (P6) | Cost of capital 18% by default (a business on the old 12% default moved); the customer charge only past due + grace, only when switched on (`finance-p6-e2e`, `receivables.service.spec`) | — |
| MS §32 | Dispute pauses accrual; 30 days idle → resumes + critical; rejected → accrues from the original due date; partial → accepted part stops, rejected part accrues | Done (P6) | A close records the amount accepted (credited by a credit note); the paused days are charged once on what wasn't accepted; 30 days without action ends the pause and charges the paused days (`finance-p6-e2e`, `finance-math.spec`) | — |
| MS §33 | Payment score 0–100; customer score 35/25/15/15/10; provisional | Missing | Current score is 0–5 from on-time share | P4 |
| MS §34–35 | True cost; contribution hierarchy Business → Route → Trip → Vehicle → Product → Customer/Order; net after finance | Done (P5) | Rule C6: `GET /costing/contribution` at all seven levels, each tying out to the business; finance cost by rupee-days; Profit & Insights → True cost & contribution | P5 |
| FX 8 | Cost allocation rules (fuel, vehicle, labour spread to orders, each rupee once) | Done (P5) | Rules C1–C4 (D1 answered: two pools): allocated at the close, to the paisa; driver base pay never allocated | P5 |
| FX 1–3 | COGS at delivery, by lot | Done | `receivables.service.ts` (`cogs_recognized`) | — |
| FX 2 | Journals: shrinkage ✓, finance charge ✓, vehicle disposal ✓, farmer advance ✓, bad debt ✓, credit note ✓, agent commission ✓ | Done (P6) | Each with a test that balances: `credit-notes.spec`, `agents-finance.service.spec`, `finance-p6-e2e` (trial balance even, every control account agreeing) | — |
| FX 4 | Period close, lock, 5-step checklist | Partial | (P0) Close, lock, reopen tested (`accounting-e2e`); the five steps are in the client's 15-part document we haven't received | D0 |
| FX 5 | GST incl. exempt, HSN, TDS farmer/agent, e-invoice ready | Done (P6) | TDS on agent commission doesn't apply (the client, 10 Nov 2026), so agent payments carry none; credit notes reduce output GST and are reported in GSTR-1 (CDNR, CDNUR, B2CS) and netted in GSTR-3B (`tax.builders.spec`, `finance-p6-e2e`) | — |
| FX 12 | Rate and terms changes as dated versions | Done (P6) | Customer credit terms too: every change a version with who and when, shown on the Credit tab (`finance-p6-e2e`) | — |
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
| D10 | Accounting Engine CN.4: a credit note needs "a role distinct from the invoice issuer". In a business one person runs, that person both issues (delivers) and would approve. | Built as a person rule: whoever issued the invoice can't approve a credit note against it (a second login — the accountant — can). Confirm, or name the role that may approve its own. | Built (P6) |

**The client's answers, 10 Nov 2026** (to our message numbering D0–D10 and two P6 choices):

| # | Answer | What it means for the plan |
|---|---|---|
| D0 | No answer | The 15-part document is still outstanding — ask again before P3 |
| D1 | "Running pool + loading pool" | Agreed: the two pools as recommended; the running pool's KG/service-time split is a setting (default 50/50). P5 can start |
| D2 | Yes | Confirmed as built (P1) |
| D3 | OK | Agreed: V1 groups, Driver Cash under My, Incentives its own entry. P2 can start |
| D4 | OK | Confirmed as built (P1) |
| D5 | OK | Confirmed: exact decimals |
| D6 | "No default price; recommend price using AI target net profit" | Remove the product reference price; the price an order starts from is the AI's recommendation for the owner's **target net profit** — after the true cost of serving (P5), not only gross margin. So P3's pricing follows P5 |
| D7 | OK | Agreed. P7 can start |
| D8 | OK | Agreed. P10 can start |
| D9 | OK | Agreed. P4 can start |
| D10 | "Owner itself" | The owner may approve a credit note on an invoice they issued; anyone else may not (built, P6) |
| TDS on agent commission | "Do not consider TDS, not applicable" | Agent payments carry no TDS (built, P6); the 194H default section stays in the tax settings, unused |

**Terminology — the aliases table (the client, 20 Nov 2026).** "English
meaning to other language Google translate seems awkward… Customer → കസ്റ്റമർ
(ml), கஸ்டமர்ஸ் (ta). Can we maintain an English aliases table?" Yes:
`apps/owner-app/src/lib/i18n/aliases.ts` holds one word per core term per
language — the English word as people say it, in their script, or the native
word where that is the everyday one — and `aliases.test.ts` makes every
applied word the rule in both apps (owner dictionaries and the driver app's
strings.xml, plurals included): no replaced word anywhere, and every text that
names the term in English uses it. Applied: **Customer** in all three
languages (ml and ta the client's words; kn by the same rule, to confirm) —
111 ml, 110 ta and 111 kn strings across both apps. The other 27 rows are
proposals for the client to confirm or correct; each is applied the same way
once confirmed.

**Customer onboarding (the client, 20 Nov 2026).** "Name, Contact person,
Phone number, location: GPS coordinates, Land mark, Shop photo front" — the
New customer form asks for them in that order, then village/town, route,
delivery address, email, notes and credit. The contact person sits with the
phone (`contact.person`); the GPS position is the customer's map pin
(`fulfilment.place_pin`, which route planning and the driver's stop already
read) — "Use my location" on the phone at the shop, typed, or a pasted Google
Maps link; half a location or 0, 0 is refused. The landmark and the shop front
photo are on the customer (migration `20261120080000_customer-onboarding.js`,
tested down and up as `migrator`; `POST`/`GET /customers/:id/shop-photo`,
JPEG/PNG/WebP checked by their bytes, kept under the business and the
customer, shrunk to 1600 px on the phone before sending). Shown on the
profile, editable in Edit details. The owner app's Permissions-Policy now
allows geolocation for its own pages (it was off everywhere, so the button
could never have worked). Proof: 9 new tests in `customers.service.spec`,
`parseLocation` in `parse.test`, new `customer-onboarding-e2e.js` 32/32.
Next: show the landmark, contact person and photo to the driver at the stop
(driver app).

**Opening balances, the finance-cost switch, three buttons (the client, 20 Nov
2026).** "Both customer farmer need opening balance. If they bring old
customer in to that it helps"; "Finance cost Enable or disable" on Add
customer; "Dashboard Procurement Delivery three button enough".
- *Opening balances* (migration `20261120090000_opening-balances.js`, tested
  down and up as `migrator`): a customer's is its own invoice, kind
  `opening` (OB-000001) — no goods, no GST, one per customer — Dr Accounts
  receivable / Cr **Opening balances** (new equity account 3050); a farmer's
  is a payable of kind `opening` with no lot — one per farmer — Dr Opening
  balances / Cr Accounts payable — farmer, an existing advance meeting it
  first, no TDS. Statements, receivables, aging, the credit limit,
  collections, payments (oldest first, or the opening balance by name) and
  credit notes (which reverse Opening balances, not sales) carry them;
  sales, product profit, purchase totals, the 194Q TDS threshold and GST
  returns never count them. Dated today unless the owner says, never in the
  future or a closed period, due that day unless given. `POST
  /finance/customers/:id/opening-balance`, `POST
  /finance/farmers/:id/opening-balance` (accounting:post); the amount on Add
  customer / Add farmer, the line and an "Opening balance" button on each
  profile. Found on the way: the customer statement called every non-sale
  invoice a "Finance charge on …" — crate charges and spot sales now read as
  themselves.
- *Finance cost on Add customer*: on or off from the start (off unless
  switched on; on only with a rate, 18% a year suggested), in the customer's
  first terms version.
- *Bottom bar*: Dashboard · Procurement · Delivery (delivery orders); the
  rest is in the side menu (☰).
Proof: `opening-balances.service.spec` (new), opening balances in
`receivables.service.spec` and `payables.service.spec`, the finance cost in
`customers.service.spec`; new `opening-balances-e2e.js` 34/34 (the books,
GST, the statement, the credit limit, payments, a credit note, farmer
payables, closed periods, the forms and profiles on a phone);
`redesign-home-e2e` checks the three buttons; `accounting-e2e` counts 55
accounts.

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

Rules and their proof (written before the code, 10 Nov 2026; D1 answered —
two pools; where the Cost Allocation Engine v1.0 differs from the client's v3
spec, v3 governs: driver base pay is never allocated):

| # | Rule | Built as | Proved by |
|---|---|---|---|
| C1 | A trip's cost, worked out once when it closes, from what was recorded — never an estimate where an actual exists. **Running pool:** fuel (the trip's fuel expenses the owner didn't reject, and fuel logs tied to it), tolls and parking (cash or FASTag), road repairs, the driver's incentives for the trip, other expenses, and the vehicle's share — the trip's km × the vehicle's cost per km over the 30 days before its close day: depreciation, documents and hire spread over the days they cover, and a one-off (a repair, loan interest, fuel not tied to a trip) over the 30 days from when it was paid, all over the km of its trips closed in those days. Every trip closing on a day uses the same rate, so no cost is charged again by each trip that closes while it is in the window, and steady running absorbs what the vehicle cost; a vehicle with no km in those 30 days carries none yet. **Load pool:** loading labour, helpers' incentives, stock written off on the trip (shrinkage, rejection) at its lots' cost. **Never:** driver base pay (MS §34) | `money.trip_cost`, insert-only, in the close's own transaction; `GET /costing/trips/:id` (finance:read); the closed trip's Cost panel | `costing-math.spec`; `costing.service.spec`; `costing-p5-e2e.js` |
| C2 | Two pools (D1): the load pool by KG delivered; the running pool α% by KG and the rest by verified service minutes (arrival to completion, phone-stamped, at most 3 hours), α a dated setting (default 50%). A customer without 30 days of service-time history takes their KG share for the service part too. Pickups share the running pool by KG received — the inbound leg, charged to their lots | `money.cost_allocation_setting` (dated; `PUT /costing/settings`, finance:manage); keys per stop, then per line | `costing-math.spec`; `costing-p5-e2e.js` (60/40 with two customers on minutes, to the paisa against an independent working) |
| C3 | Every rupee once: each component split by largest remainder in paise; a stop's share split to its lines by KG; allocated + unallocated = the trip's cost exactly; with nothing to carry a pool (no deliveries, no pickups) it is unallocated, with the reason | `money.trip_cost_allocation`, per order line or lot, per component | `costing-math.spec`; `costing-p5-e2e.js` (to the paisa) |
| C4 | KG: kg and g lines by quantity delivered; any other unit by the product's weight per unit (new, optional — an egg ≈ 0.06 kg). A line with no weight carries no KG share and is flagged on the trip | `product.unit_weight_kg` | `costing-math.spec`; `costing-p5-e2e.js` |
| C5 | Standard vs actual (FX 7): the trip's delivery cost per KG against the standard — the 30 days before it on the same route (3 closed trips or more), else the business (3 or more), else none yet; the variance shown on the closed trip | On `trip_cost` | `costing-p5-e2e.js` (the business standing in for a route with too few trips; the route's own from 3); the trip panel |
| C6 | True cost and contribution (MS §34–36): per order line, revenue − purchase (its lots) − agent (its lots' commission per kg) − labour − fuel − tolls − vehicle − shrinkage/rejection − other = operating contribution; − finance cost (what was owed × days × the cost of capital ÷ 365, partial payments counted) = net after finance. Rolled up Business → Route → Trip → Vehicle → Product → Customer → Order; unallocated trip cost and the inbound leg at the levels that hold them | `GET /costing/contribution?level=&from=&to=` (finance:read); Profit & Insights → True cost & contribution | `costing-math.spec` (rupee-days); `costing-p5-e2e.js` (the levels tie out) |
| C7 | Fed to AI Pricing: the delivery cost per KG in the price build-up and each customer's delivery cost come from the allocations | AI data reads `trip_cost_allocation` | `ai-e2e`; `costing-p5-e2e.js` |
| C8 | Trips closed before this: costed once, on request, from what was recorded | `POST /costing/backfill` (finance:manage; idempotent, one transaction per trip, `source = 'backfill'`) | `costing-p5-e2e.js` |

### P6 — Finance completions (MS §11–12, §30–31, §53; FX 2, 5, 6, 12)

Rules and their proof (written before the code, 10 Nov 2026; Accounting Engine rule IDs where it has them):

| # | Rule | Built as | Proved by |
|---|---|---|---|
| F1 | Credit notes (CN.1–CN.4): against an invoice, never editing it; Dr Sales returns and allowances (contra revenue) and the output tax it carried, Cr receivable; approved by someone other than the invoice's issuer | `money.credit_note` (CN-000001), reducing the invoice's outstanding in `invoice_balance`; issued by closing a dispute with an accepted amount (or directly by the owner) | `credit-notes.spec.ts`; `finance-p6-e2e.js` (trial balance even) |
| F2 | Dispute finance (MS §32): the accepted part stops for good (its credit note); the rejected part's paused interest is caught up from the original due date | A dispute closes with accepted and rejected amounts; the finance-charge run charges the rejected amount for the paused days once | `finance-math.spec.ts`; `finance-p6-e2e.js` |
| F3 | Bad debt (BD.2, BD.4): written off only by the owner or a finance lead, never automatically; Dr Bad debts, Cr receivable; the customer goes on credit hold for review | `money.receivable_write_off`, reducing outstanding; customer credit hold "Bad debt written off — review credit terms" | `finance-p6-e2e.js` |
| F4 | Agent commission (AGT.1–AGT.3): accepted KG × the purchase's commission per KG, when the lot is accepted; Dr Agent commission, Cr Accounts payable — agents (party: the agent), traceable to the lot and rate | New accounts and the `agent` ledger party; paid like a farmer payable — no TDS (the client, 10 Nov 2026) | `finance-p6-e2e.js` |
| F5 | Finance cost (MS §31): internal cost of capital 18% by default; the customer charge only when switched on, only past due | `ai_settings` default 18 (a business that never changed it moves to 18); `customer.finance_charge_enabled`, off by default, on for customers who already had a rate | `receivables.service.spec.ts`; `finance-p6-e2e.js` |
| F6 | Credit terms as dated versions, not overwrites (FX 12) | `customer_terms_version`: every change of limit, days, charge, hold, with who and when; the customer's Credit tab lists them | `finance-p6-e2e.js` |
| F7 | Farmer payment terms (MS §12): Immediate, Bill-to-Bill, Net 3/7/10/15/20/30/45/60, Custom; due dates; overdue; average payment days | `farmer.payment_terms_days` (+ Bill-to-Bill); a payable's due date from the terms in force when it accrued; the farmer profile's overdue and average days | `finance-p6-e2e.js` |
| F8 | Customer Bill-to-Bill (MS §30): the previous bill falls due when the next is issued | The invoice keeps its terms; `invoice_balance` reads a Bill-to-Bill invoice's due date as the next invoice's issue date | `finance-p6-e2e.js` |
| F9 | Driver cash recovery (MS §53): approved expenses, then settlements, then advance recovery | Checked against what's built; a test either proves it or the gap is written down | `finance-p6-e2e.js` |

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
- ~~**TDS 194H** on agent commission (from P0).~~ Not applicable (the client, 10 Nov 2026).
- Customer finance charge: explicit on/off per customer (off by default).
- Default internal cost of capital **18%** a year (MS §31; today 12%); a
  business that never changed it moves to 18%, one that chose a rate keeps it.
- Customer credit terms as dated versions, not overwrites.
- Driver cash recovery priority (approved expenses → settlements → advance
  recovery) checked in tests.
- **Done when:** each journal in FX 2 has a test that balances; trial balance
  stays even across the e2e chains.

Built as decided (10 Nov 2026):

- **CN.4** is a person rule (D10): the invoice's issuer can't approve a credit
  note against it — directly or by accepting part of a dispute — except the
  owner, who may approve their own (the client's answer, 10 Nov 2026).
- A credit note is spread over the invoice's lines in proportion and takes back
  the GST each carried (GST Act s.34), in integer paise; a finance charge's note
  reverses finance-charge income, a crate charge's crate recoveries. Goods
  physically returned to stock (CN.3) belong to P8.
- **Write-off** posts BD.1's provision then BD.2's write-off against it (net:
  Dr Bad debts / Cr receivable), only by `finance:manage` (owner, accountant),
  never while a dispute is open, once per invoice; the customer is put on hold
  for review (BD.4). Not built: BD.1's scheduled provision by an overdue
  threshold, and BD.3's reinstatement — a written-off customer who pays later
  is recorded as a payment held on account.
- **Dispute catch-up**: each finance-charge period records the disputed amount
  it left out; when the pause ends — closed with part not accepted, withdrawn,
  or 30 days without action — the next run charges the unprotected amount for
  those days once, as its own finance-charge invoice tied to the dispute.
- **Agent commission** is earned on lots weighed in kg (or grams); a lot
  counted in pieces or crates earns none. Paid in full: no TDS, which the
  client confirmed doesn't apply (10 Nov 2026). The agent's PAN is kept as a
  detail; the payment table's TDS columns, already migrated, stay at none.
- **Bill-to-Bill** (customers and farmers) keeps a backstop — the terms' days —
  so a bill never waits for ever when no next bill comes.
- **Farmers** default to Immediate; payables accrued before terms existed fall
  due the day they accrued.
- **Cost of capital**: a business still on the old 12% default moved to 18%;
  any other rate stays.
- **Driver cash (F9)** needed no change: the priority already holds (MS §53 row
  above); the running driver-cash view is P2's.

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
| P2 Navigation | Not started | D3 answered (10 Nov 2026) |
| P3 Prices & commercial control | Not started | Needs D0 (D6 answered: AI price for target net profit — after P5) |
| P4 Service effort & customer economics | Not started | D9 answered |
| P5 Cost allocation & true cost | Done (20 Nov 2026) | C1–C8 above (D1: two pools). Migration `20261114080000_cost-allocation.js` (`money.trip_cost` and `money.trip_cost_allocation`, insert-only with forced RLS, checked at commit to add up to the paisa; `money.cost_allocation_setting`, dated; `product.unit_weight_kg`), tested down and up as `migrator`. A trip is costed in its close's own transaction — allocation, not posting: no ledger entry. API: `GET /costing/trips/:id`, `GET /costing/contribution` (seven levels, net after finance), `POST /costing/backfill`, `GET`/`PUT /costing/settings`; AI Pricing and customer profitability read the allocations (`deliveryWindow.source`: allocated or estimated). Owner app: Cost of this trip on a closed trip (pools, vehicle km × rate, where it went, per KG against the standard, the variance); True cost & contribution on Profit & Insights (level tabs, a row's breakdown, the split and its change, costing earlier trips); weight per unit on products. Suites: new `costing-p5-e2e.js` 39/39 (every allocation to the paisa against an independent working of the formula; desktop and phone widths); the contribution section's grid column made shrinkable after it widened the Profit page on a phone and broke `redesign-money-e2e`'s period click. Every chain green — 48 suite runs, 1,453 checks (the 11 Nov full run; modules, redesign and P5 rerun on 20 Nov after that fix); backend 713/713 (`costing-math.spec`, `costing.service.spec`, weight per unit in `products.service.spec`, the close in `logistics.service.spec`); owner app lint, typecheck and build clean. ERD regenerated: 141 tables, 0 without forced RLS, 0 unindexed business foreign keys |
| P6 Finance completions | Done (10 Nov 2026) | F1–F9 above. Migration `20261113080000_finance-completions.js` (credit notes and their lines, write-offs, finance-charge pauses and catch-ups, agent commission and payments, customer terms versions, the agent ledger party and accounts, farmer terms and payable due dates, Bill-to-Bill, the finance-charge switch, 194H, cost of capital 18%; `invoice_balance` nets credit notes and write-offs and reads Bill-to-Bill due dates), tested down and up as `migrator`, the backfills on real rows. API: `/finance/credit-notes`, `/finance/invoices/:id/write-off`, `/finance/write-offs`, `/finance/agents`, `…/agents/:id/payments`, dispute close with `acceptedAmount`, `/customers/:id/terms-history`, `PATCH /procurement/agents/:id`, farmer terms; GSTR-1 CDNR/CDNUR and GSTR-3B netting. Owner app: Credit notes & write-offs, Agent commission, dispute settlement, the finance-charge switch, Bill-to-Bill and terms history on the Credit tab, farmer terms, overdue and average days, agent PAN, credit notes in GSTR-1. Suites: new `finance-p6-e2e.js` 69/69 (after the client's answers: the owner's own credit notes, no agent TDS); `finance-e2e` and `chicken-eggs-finance-e2e` switch the finance charge on; `accounting-e2e` counts 54 accounts. All 47 suites green across every chain; backend 686/686 (`credit-notes.spec`, `agents-finance.service.spec`, `splitCreditNote`/`disputeCatchUp`/`agentCommission` in `finance-math.spec`, GSTR-1/3B credit notes in `tax.builders.spec`, terms versions, farmer terms, commission at grading, the MS §53 priority in `payroll-math.spec`); owner app lint, typecheck and build clean. ERD regenerated: 138 tables, 0 without forced RLS, 0 unindexed business foreign keys |
| P7 Workforce engine v2 | Not started | D7 answered |
| P8 Quality accountability | Not started | — |
| P9 Exceptions & approvals | Not started | — |
| P10 Communication | Not started | D8 answered |
| P11 Vehicle economics | Not started | — |
| P12 Transport scaling & cross-dock | Not started | — |
| P13 AI completion | Not started | — |
| P14 Sign-off | Not started | — |
