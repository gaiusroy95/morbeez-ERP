# Driver app — field test on a real phone (D8)

For the people running the test day: the owner (at the office, on the owner
app) and one driver (on the road, on the driver app). It takes one working
day. Every check below is something the driver or the owner does and then
looks at; tick it, or write what happened instead.

## Before the day

**The phone.** Android 8 or newer, with the camera and location working. Put
the battery saver off for the first half of the day and on for the second
(check 10).

**The app.** Install the preview build (`morbeez-driver-preview.apk`, sent with
this sheet). It talks to the hosted preview (Render, Vercel, Neon — see
`infrastructure/runbooks/render-preview.md`), not production. The first
request after the server has been idle can take about a minute; try again.

**The office.** In the owner app:

1. Workforce → the driver → **App login**: send the set-up link to the driver's phone.
2. Customers → each shop on the route → **Delivery QR**: print it and stick it at the shop (leave one shop without a QR on purpose — check 4c).
3. Customers and farmers on the route: each has a map pin (for the arrival times).
4. Trips → **Create Trip** for today: one farm, three shops, a cash advance.
5. Optional: a backhaul offer on the trip (Trip → Backhaul → Offer backhaul).

## The day

| # | What to do | What should happen | ✓ / notes |
|---|---|---|---|
| 1 | Driver: open the set-up link, set a password, sign in, set a PIN, choose the language. | The Dashboard shows today's trip, the vehicle, "Start Day". | |
| 2 | Driver: **airplane mode on**. Start Day: read the odometer, hold to start. | Starts at once on the phone; the header says Offline · 1 to send. | |
| 3 | Driver: airplane mode off. | Within a minute: Online, nothing to send. Owner: the trip shows On the road with the opening KM and the start position. | |
| 4a | Farm: accept one product, weigh it (KG or bags), load photo; reject another with a reason and photo; hold to complete. | Procurement shows the farm done and what's on the vehicle. Owner: the trip's Stops tab shows it, with the photos. | |
| 4b | Mid-farm, before completing: close the app from Android's recent apps, open it again. | The farm is as it was left (draft kept). | |
| 4c | Shop with a QR: scan it. Shop without one: "QR missing or damaged" with a reason. | Both deliveries go through; the owner sees which was scanned. | |
| 4d | At one shop deliver less than ordered, with the reason. | Owner: a shortfall alert; the invoice is for what was delivered. | |
| 5 | Collections: one cash, one UPI with its reference, one part payment, one paid by someone else. | The customer with a part payment stays on the list with the balance. Owner: Collections shows each. | |
| 6 | New Expense: fuel with the pump's details and a bill photo. | **Check before saving** reads it all back; Edit goes back to the form, Save expense saves. Owner: the trip's Expenses show the fill. | |
| 7 | Backhaul (if offered): accept, pickup reached, load photo, drop reached, delivery photo, hold to complete, payment. | Owner: the trip's Backhaul tab shows each step and the payment. | |
| 8 | Back at base: Return — closing KM, **hold to confirm**; then cash handover. | Owner: the handover is waiting to close; the expected cash matches the phone. Owner closes the trip. | |
| 9 | Earnings: My Earnings shows the day; after the owner pays the week, Settlements → hold "I received it". | Owner: the settlement shows it was received. | |
| 10 | Battery saver on; airplane mode on for **30 minutes** while doing two deliveries; then off. | During: everything works, the header counts what's waiting. After: all sent, **nothing under "Needs attention"** in Sync. Owner: Driver phones shows the phone go from Waiting to Synced. | |
| 11 | Chat: driver writes to the office with a photo while offline; signal back; owner replies. | The message shows a clock, then a tick; the owner app's menu counts it unread; the driver's chat button counts the reply. | |
| 12 | Route (side menu → Current trip): look at the stops still to do. | Each shows "≈ hh:mm", roughly right (straight-line estimate × 1.3 at 30 km/h, plus time at each stop). Navigate opens Google Maps at the stop. | |
| 13 | Side menu → Ask the office: an advance of ₹500 with a reason (once offline, then online); at a shop not on the books, a new customer with **Pin this place**. | Each is read back before it's sent; Approvals shows it waiting to send, then pending. Owner: Approvals lists both; approving the advance (less than asked, by UPI) and the shop shows them approved on the phone; the shop is a customer with its map pin. | |
| 14 | Before the day the owner adds the van's FASTag (Vehicles → the van → FASTag) and recharges it. Driver: a toll with **Paid by FASTag**. | No bill needed; the handover's expenses don't include it. Owner: the van's FASTag statement shows the toll with the trip; the balance went down. | |

## Conflicts (the office and the phone disagree)

After the day's trip is closed, the owner plans a **short second trip** (one
shop) for the driver. Do these with the driver's phone in **airplane mode**
while the owner changes something, then switch signal back on.

| # | What to do | What should happen | ✓ / notes |
|---|---|---|---|
| C1 | While the driver is offline, the owner records a fuel fill on the van with an odometer 50 km above its last reading (Vehicles → the van → Edit & record). Driver starts the day with a reading between the two — the phone doesn't know the newer one yet — then goes online. | Sync shows Start Day under Needs attention with the office's words and the newer reading; **Correct opening KM** sends it again in its place; the trip starts. | |
| C2 | Driver (offline) completes the delivery and records a cash collection; owner meanwhile cancels the trip (Trips → the trip → Cancel trip); driver goes online. | The delivery is refused: Sync lists it under Needs attention with the office's words; the collection waits behind it. Nothing is marked stuck for lack of signal. | |
| C3 | Owner: Driver phones. | The driver's card shows **Stuck**, with the office's words. | |
| C4 | Driver, in Sync: **Remove from phone…** the refused delivery, then the collection. | Each asks first; the collection (money) asks what happened. The office's chat gets a message from the driver for each, saying what was removed and why. Sync is empty; Driver phones shows **Synced**. | |
| C5 | Owner plans a third short trip, then cancels it before the driver starts it; driver (offline) tries Start Day, then goes online. | Nothing is started; the cancelled trip leaves the phone. | |

## What to write down

- The phone's make, model and Android version.
- Battery used over the day (Settings → Battery) and mobile data used by the app (Settings → Network → Data usage).
- Anything slow, confusing, or worded so the driver didn't understand it — with a screenshot.
- Any number the owner sees that doesn't match the phone.

## It passes when

- No action done on the phone is lost: everything reaches the office, or is in Sync with the office's reason.
- No dropped connection is ever shown as "Needs attention" — only the office's refusals are.
- Every amount and reading the owner sees matches the phone.
- The driver could do each step without help.
