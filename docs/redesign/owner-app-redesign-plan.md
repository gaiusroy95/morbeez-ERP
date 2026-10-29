# Owner app redesign — implementation plan

Source: the client's mockups "MORBEEZ OWNER APP — Screens 1–24" and
"8 Screens – Complete Daily Operation Flow (Bare Minimum)" + "Next 8
screens" (V1.1), received 22 Oct 2026. Goal: the owner app looks like the
mockups and every button on them works against real data.

## Decisions taken (change here if the client disagrees)

| Topic | Decision | Why |
|---|---|---|
| Which mockup set wins | **V1.1** (the "Bare Minimum" + "Next 8" sheets) where the two sets differ; screens 17–24 of the first set where V1.1 has no equivalent. | V1.1 is the later, labelled version ("OWNER APP V1.1"). |
| Bottom navigation | **Home · Operations · (+) · Finance · More** (V1.1). The earlier Dashboard/Procurement/Delivery bar is replaced; Procurement and Delivery are one tap away in Operations and in the (+) menu. | V1.1. One constant to flip back if the client prefers the 3-tab bar. |
| Phone vs laptop | Phone layout is the design. On a laptop the same screens are shown centred with the side menu kept open. | The mockups are phone-only; the owner also uses a laptop. |
| Brand | Green brand from the mockups (#1F7A3A family), leaf logo, "Grow with Experts". Existing dark sidebar retired. | Mockups. |
| Document numbers | Purchase orders `P-00123`, delivery orders `D-00231`, trips `T-YYYYMMDD-NNN`, per business, never reused. | Shown on every list card. |
| Maps (Trip details) | Static route drawing from pinned customer/farmer locations (place pins already exist); "Navigate" opens Google Maps. No live GPS tracking in this project. | Live tracking needs the driver app to stream location — a separate project. |
| AI Calling, AI Pricing, Offline Sync (screens 16, 23, 24) | Screens built in the last phase; AI Calling is Part 7 (AI voice) and is shown as "coming" until then. Offline sync is a status screen for the Driver app's queue. | The owner web app can't run offline; the driver app already does. |

## Gap analysis (what the mockups need that doesn't exist)

Backend:
- Document numbers for purchase orders, orders, trips.
- Purchase order: pickup date, driver, vehicle, agent + commission per kg, bag unit with kg-per-bag.
- Delivery order: delivery date, route, driver, vehicle, delivery address (default from customer), credit term per order.
- **Routes** master (name, ordered customers and farmers) — new.
- Trip: route, crew (packer, loader), auto-loading the route's orders for the date, quantity check (procured vs delivered vs on vehicle), closing stock.
- **Vehicle stock**: what is on each vehicle now (loaded − delivered), committed vs free.
- Customer stats: avg payment days, on-time %, score (0–5), credit risk flag, route; address.
- Farmer stats: balance, pending payment, location, main product.
- Collections list (today / pending / all) across customers and farmers.
- Agents (commission middlemen) — new, small.
- Dashboard: net contribution with % change, today's counts, merged alerts, AI insight.

Frontend: new shell (top bar, bottom nav, (+) sheet), new component kit, and 30+ screens re-laid out.

## Phases

Each phase ends with: typecheck, lint, unit tests, an e2e suite for the phase,
phone + laptop screenshots, and old e2e suites still passing. Each is pushable
on its own (migrations before push).

### Phase 0 — Design system and app shell
Goal: every existing page already wears the new look and navigation.
- Colour/type tokens, radius, shadows from the mockups; leaf logo.
- Top bar: menu, title, bell (alert count), avatar/profile.
- Bottom nav Home · Operations · (+) · Finance · More; (+) opens a quick-create sheet (Procurement, Delivery order, Trip, Collection, Customer, Farmer).
- Component kit: ListCard (number, name, place, product·qty, time, driver, vehicle, status pill), DayTabs (Today/Tomorrow/All with counts), SearchFilterBar, StatTile, MoneyTile, SectionHeader, FormSheet, EntityHeader (avatar, name, status), ActionRow (Call/WhatsApp/Navigate).
- More screen (screens 2/19/20 combined): grouped links to every module, Language, Help, Logout.
- Done when: all current pages render inside the new shell on phone and laptop; e2e suites pass.

### Phase 1 — Home dashboard and Operations hub (screens 1, 2)
- Backend: `GET /dashboard/home?period=today|week|month` → net contribution (sales − purchases), change %, receivables, payables, cash, active trips (x / y), today's counts (procurement, deliveries, collections, active trips), alerts (merged dashboard + owner alerts), one AI insight (latest open recommendation).
- Frontend: Home exactly as mockup; period picker; every tile opens its list; alert rows open the right screen; Operations hub with 6 tiles.
- Done when: every number traces to a list that shows the same total (e2e checks the sums).

### Phase 2 — Procurement (screens 3, 4)
- Backend: PO number; pickup date, driver, vehicle on the PO (creates/updates the pickup); agents table + commission per kg; quantity unit kg or bag with kg-per-bag; list filter by day (today/tomorrow/all), search, status.
- Frontend: Procurement list cards; Create Procurement form (farmer search with card + View, products table with Add Product, agent + commission, notes).
- Done when: a PO made on the form appears on the list, on the farmer's page, and on the trip planner.

### Phase 3 — Delivery orders (screens 5, 6)
- Backend: order number; delivery date, route, driver, vehicle, delivery address, credit term; list by day/search/status.
- Frontend: Delivery Orders list; Create Delivery Order (customer search card, route, date, driver/vehicle, products, "Use default" address).
- Done when: order → confirm → appears on the trip for its route/date.

### Phase 4 — Routes and Trips (screens 7, 8, 9)
- Backend: routes master; trip number; trip route; crew (packer, loader from workforce); "orders for route + date" loader; select procurement on the trip; quantity check (procured, delivered, vehicle stock, difference); close trip uses existing reconciliation.
- Frontend: Trips list; Create/Assign Trip (auto-loaded orders, procurement checkboxes, Add Farmers, crew, quantity check, Review); Trip details tabs Overview/Stops/Quantities/Expenses with reconciliation table and Close Trip; route drawing.
- Done when: plan → driver app runs it → quantities reconcile → close.

### Phase 5 — Customers and Farmers (screens 10, 11, 12)
- Backend: customer address, route, rating/score, avg payment days, on-time %, sales total, credit-risk flag; farmer location, main product, balance, pending payment; list filters (Active / Credit / By Route; Pending Payment / Active / By Location).
- Frontend: lists with search + filters; Customer profile tabs Overview/Orders/Payments/Credit/Profit; Call / WhatsApp / Navigate; Edit, New Order; Farmer profile likewise.

### Phase 6 — Inventory, Collections, Finance, Profit (screens 13, 14, 15, 16)
- Backend: vehicle stock (per vehicle: product, kg; on vehicles / committed / free); collections list across customers (and farmer payments) with today/pending/all; finance summary for a period; product-wise profit and margin.
- Frontend: Inventory (Vehicle Stock / Total Stock), Collections (+ Add Collection), Finance hub with ledger links, Profit & Insights.

### Phase 7 — Workforce & Vehicles, Approvals, Reports, Settings, Profile (screens 15, 17–22 of set 1)
- Workforce & Vehicles list, Vehicle details (overview/trips/maintenance/costs), Approvals & Exceptions inbox (expense, credit limit, price change, AI order, driver advance, new customer), Reports list with CSV/PDF export, Settings, My Profile.

### Phase 8 — AI and sync screens (set 1: 16, 23, 24)
- AI Orders (approve WhatsApp/AI orders), AI Pricing, AI Calling (Part 7), Sync status for driver devices.

## Status

| Phase | State | Evidence |
|---|---|---|
| 0 — Design system and shell | Done (23 Oct 2026) | `app/redesign.css`, `AppShell`, `nav.ts`; (+) sheet; `?new=1` opens create forms |
| 1 — Home and Operations hub | Done (23 Oct 2026) | `GET /dashboard/home`; `components/home/Home.tsx`; `/operations`; e2e `redesign-home-e2e.js` 35/35, run after the trading chain so the sums are checked on real data |
| 2 — Procurement | Done (23 Oct 2026) | Migration `20261023080000_procurement-redesign.js` (P-numbers, pickup plan, agents, bags); `GET /procurement/board`, `GET/POST /procurement/agents`; new Procurement list and Create Procurement form; e2e `redesign-procurement-e2e.js` 45/45. The farmer's page part moves to Phase 5 (no farmer profile yet); agent commission is recorded, not yet posted as a payable |
| 3 — Delivery orders | Done (23 Oct 2026) | Migration `20261024080000_delivery-orders-redesign.js` (D-numbers, delivery plan, address, credit term per order; routes master; customer place / address / usual route); `GET /orders/board`, `GET/POST /routes`; new Delivery Orders list and Create Delivery Order form; the order's credit term sets its invoice due date; e2e `redesign-orders-e2e.js`. "Save Order" confirms when credit and stock allow, else saves it unconfirmed and says why (since D0 only credit can hold it back; stock not yet in is "to come") |
| 4 — Routes and Trips | Done (28 Oct 2026) | Migration `20261028080000_routes-and-trips.js` (route stops in visiting order, replacing customer.route_id; trip number T-YYYYMMDD-NNN, route, packer, loader; closing stock on the closure); `GET /logistics/trips/board`, `GET /logistics/trips/plan`, `GET /logistics/trips/:id/quantities`, `GET/PUT /routes/:id/stops`, `PATCH /routes/:id`; new Trips list, two-step Create Trip, trip details with Overview / Stops / Quantities / Expenses tabs and a route drawing from map pins, Routes screen; vehicle counted at closing; packer and loader credited with the trip's work; e2e `redesign-trips-e2e.js`. Deliveries still go out with stock reserved at confirmation (whole lots) — same-day "pick up at the farm, deliver to the customer" needs the stock change decided for Phase 6 (since done: driver-app D0) |
| 5 — Customers and Farmers | Done (28 Oct 2026) | No migration. `GET /customers/board`, `GET /customers/:id/profile`, `GET /farmers/board`, `GET /farmers/:id/profile` (money only with finance:read, orders with orders:read, purchases with procurement:read); Customers list (All / Active / Credit risk / Overdue, by route, search) and Customer Profile (Overview / Orders / Payments / Credit / Profit; Call, WhatsApp, Navigate; New Order prefilled); Farmers list (All / Pending Payment / Active, by location, search) and profile (Overview / Purchases / Payments; New Procurement prefilled); customer score and credit-risk rules in `customers/customer-insights.ts`; e2e `redesign-parties-e2e.js` |
| 6 — Inventory, Collections, Finance, Profit | Done (29 Oct 2026) | Built on driver-app Phase D0 (stock by the kilo and by place, vehicle stock — docs/redesign/driver-app-v1-plan.md). No migration. `GET /inventory/vehicles` (each vehicle on the road or with stock aboard: driver, in transit / available, products with committed = reserved or still to deliver, never more than aboard, and free); `GET /finance/collections` (today's payments, customers with money fallen due, all payments — each with what the customer owes now; walk-in spot buyers left out); `GET /dashboard/finance` (receivables, payables, cash now; the period's expenses from the ledger's P&L); `GET /dashboard/insights` (revenue, total cost, net profit, margin from the ledger's P&L, change on the period before; product-wise profit from invoiced sales against the cost of the kilos sold). Inventory (Vehicle Stock / Total Stock, lots and their actions kept), Collections (Collect, Add Collection, also in the (+) sheet), Finance hub (four tiles, five links; the old reports open from it), Profit & Insights (Today / Week / Month / Custom); Collections and Profit & Insights in the menus; e2e `redesign-money-e2e.js` |
| 7–8 | Not started | |

## Order of work and checkpoints
Phases 0 → 8 in order. After each phase: report to the owner with screenshots,
then push (run `pnpm db:migrate` on Neon first when the phase has migrations).
