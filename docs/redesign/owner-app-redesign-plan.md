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

Decisions for Phase 7 (change here if the client disagrees):

| Topic | Decision | Why |
|---|---|---|
| What the inbox holds | Everything already waiting for the owner, in one list: a driver's expense beyond their authority (Approve / Reject here), purchase orders and delivery orders over their approval threshold (Approve / Reject here, then confirmed or cancelled at once), a spot sale priced outside its band (Approve / Reject here), AI suggestions still open (pricing ones under Price; Review opens them), invoice disputes still open, trips handed over and waiting to be closed. Tabs All · Expense · Price · Other. | The mockup's "one place for all approvals and exceptions". |
| Driver advance, new customer, credit-limit requests | Not in the inbox yet: nothing in the system asks for them today (an advance is given, not requested; customers and credit limits are set by the owner). They join the inbox when the driver app or AI orders start asking (D6, Phase 8). | Don't show requests no one can make. |
| A rejected expense | Stays on the trip, marked rejected with the owner's reason; closing the trip shows it as an exception to settle with the driver. Nothing is deducted from pay automatically. | Driver spec §23: no automatic salary deduction. |
| Reports | Eight reports from the books and the operations (sales, procurement, customer profitability, product, farmer, trip / route, vehicle, workforce) for any date range, each downloadable as CSV and printable to PDF from the browser; Financial opens the existing statements (P&L, balance sheet, trial balance, GST); Export data downloads the master lists (customers, farmers, products). | One report shape for all; no PDF library to maintain. |
| Settings | A hub: Company profile, Users & permissions and Rates & rules (approval thresholds, alert thresholds, loss tolerances) are edited there; Products, Routes, Vehicle costing, Leave policy (payroll settings) and Notifications open their existing screens. The ten driver incentives (V1.18) are added to Rates & rules with driver-app D7, once the client lists their bases (their answer 7). | Most settings already exist; this gives them one door. |
| Workforce & Vehicles | The Workforce and Vehicles pages open on the mockup's cards (Active / On trip / Inactive; On trip / Available / In maintenance / Not fit), with their existing sections (pay, attendance, fleet books) one tab away. Vehicle details: Overview / Trips / Maintenance / Costs. | Keeps every existing function. |

### Phase 8 — AI and sync screens (set 1: 16, 23, 24)
- AI Orders (approve WhatsApp/AI orders), AI Pricing, AI Calling (Part 7), Sync status for driver devices.

Decisions for Phase 8 (change here if the client disagrees):

| Topic | Decision | Why |
|---|---|---|
| Where AI orders come from | From each customer's own ordering pattern: the usual order on this weekday that hasn't come, and an order far from it. Orders sent in on WhatsApp join as another source once the business's WhatsApp Cloud API number is connected (Phase 9). | Requirements Part 14 and 23. |
| Approving an AI order | It's a suggestion: Use this… opens the customer's order prefilled, placed under the owner's name with the ordinary rules (credit, approval limits). The AI never places an order. | AI System DR.1–DR.3. |
| AI Calling | AI voice calls aren't built (a later part, with a telephony provider). The screen shows them as coming, and today's call list — money due, orders to ask for, quantities to confirm — for the owner to call from, with Call and WhatsApp. | Useful now; the same list is what AI voice will work from. |
| AI Pricing | The minimum sustainable price from what the books hold today: stock cost, spoilage, delivery a kilo. Processing, packaging and cold chain join when they're recorded. | Requirements Part 15; nothing invented. |
| Driver phones | Each phone reports after every sync; a phone not heard from for 2 hours is "not heard from". The owner sees what's waiting and what the server refused, never the actions' contents. | The client's Offline Sync screen; the queue stays on the phone (DRV.5). |

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
| 7 — Workforce & Vehicles, Approvals, Reports, Settings, Profile | Done (30 Oct 2026) | Migration `20261104080000_expense-decisions.js` (a driver's expense beyond their authority is approved or rejected on its own, with the owner's note). `GET /dashboard/approvals` (the inbox: expenses waiting, purchase and delivery orders over their threshold, spot sales priced outside their band, open AI suggestions, open disputes, trips to close — tabs Expense / Price / Other); `POST /logistics/trips/:id/expenses/:expenseId/decision` (a rejected expense is the close's exception, to settle with the driver); `GET /reports/:kind` (sales, procurement, customer profitability, product, farmer, trip / route, vehicle, workforce, and the customer / farmer / product lists — each needing its screen's permission, with exact totals); `GET /users/team`, `GET /users/roles`, `POST /users/:id/roles/:roleId/remove` (never your own), `GET /users/me/activity`; `GET /logistics/trips/on-the-road`, `GET /logistics/trips/vehicles/:vehicleId`. Owner app: Approvals & Exceptions (approve / reject an expense, an order, a purchase order — confirmed or cancelled at once — or a spot-sale price right there; Review opens the rest), Reports (Operational / Financial / Sales; any dates; Download CSV; Print / PDF; Export data), Settings (Company profile, Users & permissions, Rates & rules with approval limits, Notifications with alert thresholds and loss tolerances; the rest open their screens; Logout), My Profile (who you are, activity, password, language, plan), Workforce and Vehicles open on the client's cards (Active / On trip / Inactive; On trip / Available / In maintenance / Not fit) with their existing sections a tab away, Vehicle details (Overview / Trips / Maintenance / Costs; the full fleet record behind Edit & record), Collections & Payments with a Farmer tab (who is owed, Pay); ?open= links into orders, purchase orders, trips and farmers; a Management group in the menu. e2e `redesign-admin-e2e.js` (32 checks; the redesign chain 13/13 suites, modules and handover green); `fleet-ui-e2e.js` and `workforce-ui-e2e.js` updated to the cards |
| 8 — AI and sync screens | Done (30 Oct 2026) | Migration `20261108080000_ai-orders-and-phone-sync.js` (a seventh AI suggestion type, `order`, decided with `ai:decide:customers`; `identity.device_sync`: each driver phone's last report — actions and photos still on it, those the server refused and in its words, how the last pass went). AI: the order producer (requirements Part 14 and 23; `ai/math/orders.ts`) — a customer who ordered on 3 of the last 4 of tomorrow's weekday and hasn't yet: their usual order (each product taken on at least half those days, at the median, priced as last charged), and an order for today or tomorrow under half or over twice what its customer takes on that weekday, or missing a product they always take ("usually 180–220 kg … ordered only 60 kg. Confirm whether this is intentional."); `GET /ai/pricing` (Part 15: each product's stock cost, what spoilage takes, delivery a kilo over 30 days → the minimum sustainable price, the target with the owner's margin, where today's price stands, the 14-day range, the open price suggestion; a product without a price is now priced from ₹0 instead of stopping the price suggestions); `GET /ai/calls` (money fallen due as Collections counts it, orders to ask for, quantities to confirm; phones read at request time; AI voice "coming"). `POST /devices/sync-report` (the driver app after every sync pass; refusals ≤ 20, refused ≤ waiting), `GET /devices/sync-status` (each active driver: stuck / not heard from for 2 h / waiting / synced / no report, the phone's refusals, the trip they're on). Driver app: `SyncReport` sent after each pass, best effort. Owner app: AI Orders (Expected / Check quantity / Decided; Use this… opens the customer's order prefilled — placed under the owner's name, confirmed when credit allows, recorded as accepted or changed; Checked with them; Open order), AI Pricing (the build-up table and the price suggestions), AI Calling (the coming card and today's three call lists with Call / WhatsApp), Driver phones (cards, stuck first, the server's words, Call / WhatsApp / Message); the menu marks the most specific entry (/ai/orders, not /ai). e2e `redesign-ai-e2e.js` 26/26 and every chain green (41 suites); `orders.spec.ts`, cost build-up specs, `sync-state.spec.ts`; `SyncReportTest` 3/3 |
| 9 — WhatsApp orders, automated calls, Integrations; driver requests; FASTag | Done (31 Oct 2026) | Migration `20261109080000_driver-requests-fastag-and-integrations.js` (`tenant.integration_setting`: the business's WhatsApp phone number ID, replies, calls; `ai.inbound_message`: each WhatsApp message, once however often Meta delivers it, and what came of it; `ai.voice_call`: each call, its script's numbers, Twilio's status, the key pressed; SECURITY DEFINER lookups for the webhooks; `ai.run.source` — a WhatsApp order's run has no user and isn't superseded by the owner's). `GET /integrations`, `PUT /integrations/settings` (tenant:manage); `GET/POST /webhooks/whatsapp` (Meta: verify; deliveries signed with the app secret — stored at once, read after the answer); `GET /ai/whatsapp/messages`, `POST …/:id/read-again`; `POST /ai/calls/voice/preview`, `POST /ai/calls/voice`, `GET /ai/calls/voice`; `POST /webhooks/twilio/voice/:id` (TwiML), `…/keypress`, `…/status` (signed with the auth token over the public URL). Owner app: Settings → Integrations; AI Orders → WhatsApp (each message, its status and note, Read it again); WhatsApp orders on Expected with the message as evidence; AI Calling (calls on / off / not set up, Call automatically with the words it will say, the calls of the last 14 days with what was pressed); Approvals decides drivers' requests; Vehicles → FASTag. e2e `integrations-e2e.js` 41/41 (its own chain, against local stand-ins for Meta, Anthropic and Twilio) and every chain green; `channels.spec.ts` 17 (the rules reader, the reading check, Meta's and Twilio's signatures — Twilio's documented example — the call scripts and TwiML, the webhook payload, the WhatsApp suggestion) |

### Phase 9 — WhatsApp orders, automated calls, Integrations

Decisions for Phase 9 (change here if the client disagrees):

| Topic | Decision | Why |
|---|---|---|
| WhatsApp orders | Meta's WhatsApp Cloud API sends each message to the API's webhook (verified with the verify token, signed with the app secret). The sender's number finds the customer (the last ten digits); Claude reads what was ordered — any of the four languages, any script — and code keeps only products the business sells. It becomes a suggestion on AI Orders for the owner to check against the message and place; nothing is ordered by the AI. Without an Anthropic key, simple rules read plain English lines ("Tomato 20 kg"). A number no customer has, a voice note or photo, or a message that isn't an order is kept on AI Orders → WhatsApp with what came of it; Read it again after fixing the customer's number. | AI System DR.1–DR.3, REC.1. |
| Reply to the customer | Off by default; turned on, the customer gets "Thank you, … has your order: …" in their language, within WhatsApp's 24-hour window (no template needed). | The owner decides what the business says. |
| Claude | `claude-opus-5-5` (`ANTHROPIC_MODEL` to change), low effort, structured output, the server-side fallback on (a request one model declines is retried by another in the same call). If Claude fails, simple rules read the message and the note says so. | Reading a short message is quick work; a failure never loses a message. |
| Automated calls | Twilio, placed by the owner from AI Calling (never by the AI on its own), in the customer's language with Google's Indian voices: a payment reminder (the amount due now), their usual order for tomorrow, an order to confirm. One key: 1 yes, 2 call me back. AI Calling shows each call and what was pressed; nothing changes in the books. A customer who ordered on WhatsApp isn't called to ask. Off until the owner turns it on in Settings → Integrations. | Requirements Part 23; DR.1. |
| Keys | The server's (`apps/backend/.env.example`, section 4), never the owner's; Settings → Integrations shows what's set up, the webhook URL for Meta, and the business's own choices (its WhatsApp phone number ID, replies, calls). | Secrets stay out of the app. |
| Scripts | English, Malayalam, Kannada, Tamil — the three Indian languages are drafts for a native speaker, like the apps'. | |

## Order of work and checkpoints
Phases 0 → 8 in order. After each phase: report to the owner with screenshots,
then push (run `pnpm db:migrate` on Neon first when the phase has migrations).
