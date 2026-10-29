# Driver app V1 — implementation plan

Source: the client's "MORBEEZ DRIVER APP — V1 FINAL" (V1 = the operational
loop, V1.18 = incentive engine, field hardening) and the Driver App V1
design sheets (screens 1–21, side drawer, expenses / earnings / backhaul,
tablet views), received 28 Oct 2026. Goal: the driver app does exactly the
driver's physical day —

> START → PICK → LOAD → DELIVER → EMPTY VEHICLE → BACKHAUL → COLLECT → RETURN → HANDOVER → GET PAID → CLOSE

— offline-first, with every number the owner later reconciles captured on
the road.

## What exists today

Driver app (Kotlin, Jetpack Compose, ~5,400 lines; `apps/driver-app`):
password and PIN login, the trip's stops (`RouteScreen`), a stop
(`StopDetailScreen`: complete a pickup with farm weights, or a delivery with
signature / POD photo and live-bird / egg measures), cash collection at a
delivery stop, trip expenses, shortage report, report a problem, owner mode,
and an offline queue (Room + `SyncEngine` / `SyncWorker`) that replays each
action against the API. Builds locally (`F:/android-toolchain/sdk`, JDK 17).

Backend pieces it can build on: trips planned by route with stops in visiting
order, numbers and crew (owner app Phase 4); pickups completed with farm
weights → lots received; proof of delivery and customer-end measures;
collections at delivery stops (cash into the driver's float); expenses with
the delegation rules; money handover and the owner's closure with a vehicle
count; fuel logs with odometer and full-tank fills (fleet); crate movements
to and from vehicles (crates); trip work in payroll with incentive rules
(per trip, per unit, attendance); place pins for customers, farmers and the
depot.

## Decisions taken from the client's spec

| Topic | Decision | Why |
|---|---|---|
| Stock model | **Same day, farm to customer.** What is accepted at a farm goes onto the vehicle as vehicle stock; deliveries are made from vehicle stock; after the last delivery vehicle stock must be **0 kg** or be reconciled before the trip can go on. Lots are consumed by the kilo, not whole. | Spec §9, §15 and the dashboard's "Vehicle stock". This is the answer to the open question from owner-app Phases 3–5 (whole-lot reservation). |
| Order confirmation | An order no longer needs graded stock to be confirmed when it will be delivered from a trip's vehicle stock; the Create Trip quantity check (procured + vehicle stock vs delivery, the "−200 kg" warning in the mockup) becomes the stock check. Warehouse orders keep today's reservation. | Same. |
| Farmer stop | One farmer = one stop, any number of products. Each product line is **accepted** (weighed: actual quantity, KG or bags, sacks) or **rejected** (reason: quality / quantity short / damaged / farmer not ready / other, optional photo). A farmer can't be completed until every line is accepted + weighed + loaded, rejected, or an approved exception. Lines stay editable until **hold-to-complete**. | Spec §5–§8. |
| Delivery stop | Next stop stays locked until **customer QR ✓ → quantities ✓ → unloaded ✓ → photo ✓ → crates ✓**; delivered quantity per product can differ from ordered and the invoice follows what was delivered; crates sent / returned, a shortage needs a reason, never an automatic driver deduction. | Spec §11–§14. |
| Customer QR | A printed QR per customer (shown on the customer's profile in the owner app to print or share). Wrong QR blocks the delivery. | Spec §12. |
| Collections | Only customers **delivered on the current trip** appear, with their **whole current outstanding** (not just this trip's invoice). Cash adds to the driver's cash; UPI and account transfer don't. Partial collection keeps the customer on the list with the balance. A third party can pay (paid by, type). A disputed amount goes to the owner — the driver can never write off a balance. | Spec §18–§21. |
| Backhaul | A fixed-rent transport job after the last delivery: no product, no kg, no inventory. Accept or skip; pickup reached → loaded → drop reached → photo → complete → payment (cash / UPI / transfer). Must be done (or validly skipped) and paid before the trip closes. | Spec §16–§17. |
| Day frame | Start Day records vehicle, opening KM, GPS and time; Return records closing KM (after backhaul); trip KM = closing − opening. | Spec §2, §22. |
| Cash handover | Expected cash = cash collections + cash backhaul − cash expenses (+ any advance); UPI / transfer never counted; a mismatch is an owner exception; no automatic salary deduction. | Spec §23 (same rule as today's handover, plus backhaul). |
| Incentives (V1.18) | Calculated by the backend from the trip's data, never entered by the driver: fixed pay + collection, backhaul, mileage, crate, quality, new customer, performance, night duty, data quality, trip completion. The owner sets each rule's amount and condition. | Spec §24–§25. |
| Navigation | Bottom bar: Dashboard · Procurement · Delivery. Side drawer: Operations (Expense, Collections, Backhaul), My (Earnings, Incentives, Settlements), Trips (Current, Completed, History), Control (Approvals, Vehicle, Sync), Account (Profile, Language, Help). | Spec §1. |
| Maps and ETA | "Navigate" opens Google Maps with the stop's pin. Distance and time to the next stop are estimated from the phone's location and the stop's pin (straight line × road factor, average speed) — no paid routing API in V1. | Keeps V1 free of a maps bill; can switch to a directions API later. |

## The client's answers (28 Oct 2026)

| # | Question | Answer | What we build |
|---|---|---|---|
| 1 | Price at the farm | Owner sets the price | The rate on the procurement (set by the owner) is what the farmer is owed for every kg accepted at the farm; the driver never sets a price. Completing a farm stop grades its lots at that rate. |
| 2 | Start Day without a plan | Owner plans first | Start Day starts the trip the owner planned for the driver today; with none planned, the driver is told so. |
| 3 | Leftover vehicle stock | Goes back to the owner | What's left on the vehicle returns to the warehouse when the trip is closed; what's missing from the count is written off with the owner's reason. |
| 4 | Packer and loader | Own workers, contract basis, paid by quantity loaded | Chosen per farm stop from the business's workers; each is credited with the kg they loaded (piece-rate pay in payroll). "Same person" = one worker credited once. |
| 5 | Missing QR | Doesn't block — identification only | QR is scanned when there; a missing or damaged QR doesn't stop the delivery (recorded as not scanned). |
| 6 | Who creates backhaul | Either driver or owner | Both apps can create a backhaul job; the owner sees every one. |
| 7 | Incentive rules | Percentage | Each incentive is an owner-set percentage of its base (to be listed with the client at D7). |
| 8 | Driver pay | Weekly | Earnings settle weekly through payroll. |
| 9 | Chat | Yes | Driver–owner chat is part of V1 (Phase D9). |

## Questions for the client (not answered by the spec)

1. **Price at the farm.** Is the procurement rate final — the farmer is owed accepted kg × rate as soon as the farm stop is completed — or does the owner still grade and fix the price later? (Today: the owner grades each lot and sets its cost.)
2. **Start Day without a planned trip.** Must the owner plan the trip first (Create Trip), with Start Day starting it — or may a driver start a day the owner then fills?
3. **Leftover vehicle stock.** When stock isn't 0 after the last delivery, what are the choices — back to the warehouse (stock for tomorrow), a spot sale, or written off with a reason? Who approves?
4. **Packer and loader.** Are they the business's own workers (paid through payroll) set per trip, or chosen per farm (the farmer's people)? The design shows them on each farm's "Packing & Weigh".
5. **QR.** If a shop's QR is missing or damaged, can the owner approve the delivery from his phone?
6. **Backhaul.** Who creates the backhaul offer (pickup, drop, rent) — the owner in the owner app? Is the ₹3,500 rent business income, with the ₹350 backhaul incentive paid to the driver?
7. **Incentive rules.** The amount and condition for each of the ten incentives (e.g. collection: ₹ per collection or % of cash collected? mileage: against which km/l target?). We'll build them as owner settings with the client's numbers.
8. **Getting paid.** "Receive payment" on My Earnings — is the driver paid daily, at the end of each trip, or on the payroll cycle?
9. **Chat.** The tablet sheet shows "Chat" in the side bar — is driver–owner chat in V1?

## Gap analysis

Backend:
- Lots by the kilo: a lot's remaining quantity, partial consumption, cost of goods by kilos delivered (fixes the whole-lot distortion in margins).
- Farm acceptance per PO line (accept with quantity/unit/sacks, reject with reason and photo, approved exception), sacks, photos per line; lots onto the vehicle's stock location.
- Deliveries from vehicle stock: delivered quantity per line, invoice on delivered quantity, consumption from the vehicle's lots; vehicle stock by product, live; stock-must-be-zero rule and its reconciliation (return to warehouse / spot sale / write-off with reason).
- Trip: opening / closing KM, GPS at start, sequential stop lock, delivery checklist (QR, unloaded, photo, crates), customer QR tokens.
- Collections against a customer's whole balance from a trip-delivered customer; payment proof photo; reference; third-party payer; dispute → owner approval.
- Backhaul: offers, acceptance, steps, photo, payment, income posting, incentive.
- Expenses: categories (fuel, toll, parking, loading, repair, other), fuel details (odometer, fuel type, full tank, litres, rate) feeding the fleet fuel log and mileage, bill photo required.
- Incentive engine: the ten rules, computed per trip/day; My Earnings (today / week / month); settlements and "receive payment".
- Driver approvals list (their expenses, disputes, exceptions, with status).

Driver app: new shell (bottom bar + drawer + online/offline/syncing header), and ~25 new or redone screens from the design sheets; every new action queued offline; hold-to-confirm; edit-before-complete; camera for QR and photos; location for start and ETA.

Owner app: customer QR on the profile (print/share); backhaul offers; approvals inbox gets the driver's requests; vehicle stock and its reconciliation (owner Phase 6 Inventory); incentive settings (owner Phase 7 Settings); trip details show KM, backhaul, crates and the delivery checklist.

## Phases

Each phase ends like the owner-app phases: backend tests, the driver app compiled and its unit tests, an e2e suite for the new API, screenshots (emulator or device), and every existing suite still passing. Each is pushable on its own (migrations on Neon first; a new APK).

### Phase D0 — Stock by the kilo, vehicle stock (backend; shared with owner Phase 6)
- **Stock by place.** A lot's kilos are kept where they are (`stock.lot_balance`: the store, a warehouse, a vehicle), so part of a lot can go out on a vehicle while the rest stays behind. The lot's total is always the sum of its places.
- **Kilo reservation.** Confirming an order reserves only the kilos it needs from the store (`commerce.lot_allocation`), oldest stock first. Whatever isn't in stock yet no longer blocks confirmation — it's "to come" from the day's procurement, and the trip's vehicle stock shows any shortage.
- **Loading.** Starting a trip moves the kilos reserved for its deliveries onto the vehicle's stock location (made automatically per vehicle), splitting a lot when only part of it is reserved. If an earlier trip hasn't been closed and left stock aboard, that stock goes on with the new trip (counted and brought back at its closing; the earlier trip's closing then moves nothing).
- **Farm stop.** Each product line on a pickup is accepted (quantity, KG or bags, sacks) or rejected with a reason; accepted kilos become lots graded at the owner's rate, on the vehicle; the farmer is owed for them.
- **Delivery from the vehicle.** A delivery takes the delivered quantity of each line — its reserved kilos first, then free kilos on the vehicle, oldest first; cost of goods is exactly those kilos at their lots' cost; the invoice follows what was delivered. Spot sales only take free kilos.
- **Vehicle stock** by product, live, for the driver and the owner.
- **Back to the owner.** Closing a trip moves what was counted on the vehicle back to the warehouse and writes off what's missing (at cost, with the owner's reason; free kilos first, oldest first). Closed without a count, everything aboard comes back as booked.
- **Existing data.** Whole-lot reservations become kilo reservations of what each order line still needs; the kilos an earlier delivery left in a whole-consumed lot come back into stock (the books already carried them).
- Done when: a trip picks up 985 kg at a farm, delivers 600 kg to two customers from it, shows 385 kg on the vehicle, and closing returns it to the warehouse — stock, cost of goods and the books agreeing.

### Phase D1 — Shell, Start Day, Dashboard
- Bottom bar + drawer + status header; Start Day (vehicle, opening KM, GPS); Dashboard (next action, call / navigate, progress, earned so far, vehicle stock); language.

### Phase D2 — Procurement (farmer stops)
- Procurement list; farmer stop (products, accept / reject with reason and photo, crew, sacks, weigh in KG or bags, photo, load, edit any line, hold-to-complete); procurement complete with vehicle stock.

### Phase D3 — Delivery
- Delivery list and Start Trip; sequential next stop with ETA and navigation; customer QR; deliver items (delivered quantity), all unloaded, photo, crates; hold-to-complete; vehicle stock screen; stock = 0 check.

### Phase D4 — Collections, return, handover, close
- Collections (trip-delivered customers, whole outstanding, partial, third party, proof, dispute → owner); return and closing KM; cash handover; trip summary and the final close checks.

### Phase D5 — Backhaul
- Owner creates offers; driver accepts / skips, runs and is paid; income posting; part of handover and close.

### Phase D6 — Expenses, approvals, trips, vehicle, sync
- New expense (categories, fuel details, bill photo) and My Expenses with mileage; Approvals; trip history and details; vehicle (overview, maintenance, documents, dues); sync status; profile and help.

### Phase D7 — Incentives V1.18 and earnings
- The ten incentive rules (owner settings), calculated per trip/day; My Earnings (today / week / month), incentives, settlements and receive payment; live "earned so far".

### Phase D8 — Field hardening
- Offline for every new action, safe confirmations, edit-before-complete everywhere, ETA, conflict handling; a field test on a real phone.

### Phase D9 — Chat
- Driver–owner messages per trip and direct, with photos; unread counts in both apps; works offline (sent when back online).

## Order of work with the owner app

D0 is owner Phase 6's foundation (vehicle stock, kilo-level stock, margins), so it goes first. Suggested order: **D0 → owner Phase 6 screens → D1 → D2 → D3 → D4 → D5 → owner Phase 7 (approvals, settings incl. incentives) → D6 → D7 → D9 → owner Phase 8 → D8**. D7 needs the client's list of incentive bases (answer 7).

## Status

| Phase | State | Evidence |
|---|---|---|
| D0 | Done (28 Oct 2026) | Migration `20261029080000_stock-by-the-kilo.js` (`stock.lot_balance`, `commerce.lot_allocation`, `customer_order_line.delivered_quantity`, trip on stock movements; existing reservations and deliveries converted); `LotStockService` (reserve, deliver, load, carry over, return at closing, spot-sale draws) and `ProcurementService.acceptAtFarm`; pickup stop weights take `rejectedQuantity` / `rejectionReason`, delivery stop lines take `deliveredQuantity`; `GET /logistics/trips/:id/vehicle-stock`, `GET /inventory/vehicle-stock`; trip quantities from the stock movements (loaded, picked up, delivered, spot sold, returned, written off, to deliver); e2e `stock-by-the-kilo-e2e.js` 34/34, every other suite green |
| D1 | Done (29 Oct 2026) | Migration `20261030080000_driver-start-day.js` (trip `opening_km`, start position and accuracy); `GET /logistics/trips/mine/day` (today's trip only — never a later day's — its vehicle and last odometer reading, this week's earnings, vehicle stock); Start Day takes the opening KM (never below the vehicle's last fuel / maintenance / opening reading) and the phone's position, and a driver can't start a trip planned for a later day; stops carry the party's place, address and map pin, and an order's own credit days decide cash or credit. Driver app: Room v5 (the day, Start Day's readings, each stop's phone and pin), Start Day queued offline (`START_TRIP`), the shell (status header online / offline / syncing, bottom bar Dashboard · Procurement · Delivery, side drawer with later phases marked "Soon"), Start Day (hold to start, GPS, opening KM checked), Dashboard (next action with call / navigate and ETA, Start → Pick → Deliver → Summary → Complete, procurement and delivery progress, earned this week, vehicle stock), Sync (refusals in the server's words, opening KM correctable), sign-out with the unsynced warning; strings in en / ml / kn / ta (drafts). e2e `driver-day-e2e.js` 17/17 and all 32 suites green; `DayLogicTest` 13/13; screenshots without an emulator (Paparazzi, `DriverDayScreenshots`: 10 screens in `apps/driver-app/app/src/test/snapshots/images`, one in Malayalam) |
| D2 | Done (29 Oct 2026) | Migration `20261031080000_farm-stop.js` (`fulfilment.farm_stop_line`: each product accepted — by weight or sacks × kg a bag, sacks — or rejected with a reason and note, insert-only; the stop's packer and loader; photo types `load` and `rejection`, a photo naming its product). Completing a farm stop with `lines` refuses a product left open, a rejection without a reason, or a crew member who isn't an active worker — before anything is received; accepted kilos become lots at the owner's rate on the vehicle (as in D0), the packer and loader are credited in payroll with the kilos loaded (`loading` work; once when one person did both), and the owner gets a `procurement_issue` alert for rejections. `POST …/stops/:id/arrive` (Start pickup); the driver's day carries the business's workers. Driver app: Room v6 (the farm stop's draft, kept as it's typed; arrival; outcome; crew), farmer stop (products accept / reject, reject reason with photo, Pack & Weigh with crew, sacks, KG or Bags, Load Complete with Edit, checklist, load photos, hold to complete), Procurement list with each farm's outcome and "Procurement complete" with vehicle stock; queued offline (`ARRIVE_STOP`, `COMPLETE_PICKUP_STOP` after the farm's photos). Owner app: the trip's Stops tab shows each farm's outcome. e2e `farm-stop-e2e.js` 20/20 and all 33 suites green; `farm-stop.spec.ts`, `FarmLogicTest` 10/10; screenshots `FarmStopScreenshots` (9, one in Malayalam) |
| D3 | Done (29 Oct 2026) | Migration `20261101080000_delivery-stop.js` (a QR token per customer; Start Trip's `delivery_started_at`; the proof of delivery's QR scanned or not and why, and everything unloaded; `fulfilment.delivery_shortfall`, insert-only). `POST /customers/:id/qr` (a new QR; the old printout stops matching); `POST /logistics/trips/:id/start-deliveries`. Completing a delivery with the driver app's checklist refuses another shop's QR, a delivery not unloaded and a line delivered short without its reason — before anything is delivered; a missing QR is recorded as not scanned (the client's answer 5); crates left and taken back are recorded with the delivery when they add up, and otherwise the owner gets an `inventory_mismatch` alert with the driver's count (a delivery is never refused over crates); a shortfall alerts the owner (`customer_rejection`) and the invoice follows what was delivered. Stops carry each shop's QR token; the driver's day carries the crate types. Driver app: Room v7, Delivery list with Start Trip and deliveries locked to the next in order, Next stop (call, start navigation, arrived), Scan customer QR (ZXing; another shop's QR blocks, "QR missing or damaged" records why), Deliver items (delivered per line, reason when short, customer's scale for live birds, broken eggs, all unloaded, crates sent / returned, received by, photos, checklist, hold to complete), the delivered stop with Collect payment, Vehicle stock (the server's count plus what this phone has done since; "must be 0 kg", what's left goes back to the owner); the old stop and proof-of-delivery screens removed. Owner app: Delivery QR on the customer's profile (print, new QR); the trip's Stops tab shows each delivery's QR, shortfalls and crates. e2e `delivery-stop-e2e.js` 24/24 and all 34 suites green; `delivery-stop.spec.ts`, `DeliveryLogicTest` 9/9; screenshots `DeliveryScreenshots` (10, one in Malayalam) |
| D4–D9 | Not started | Plan written 28 Oct 2026; client's answers recorded |
