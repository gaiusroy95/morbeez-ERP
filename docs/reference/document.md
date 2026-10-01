**Subject: Your Morbeez specification: what we understood, where we stand, and what we need from you**

Hi,

Thank you for the detailed specification. I've read the whole document. Before building further, I want to confirm we've understood the objective, show you where the product already stands, and settle a few decisions only you can make.

## 1. What we understood

Morbeez is an AI-native operating system for small perishable-goods distributors: chicken, meat, fish, eggs, vegetables, fruit. Often the vehicle *is* the business: the warehouse, the shop and the cash counter, run by one owner-driver with no office.

The principles we'll build to:

- **The ERP records the financial truth.** AI communicates, reminds, prioritizes and explains, but never creates or changes money, stock or accounts by itself.
- **The owner decides, the driver executes, the ERP calculates.** Every KG, rupee, lot, invoice and payment is traceable, and nothing reconciles silently.
- **The owner manages by exception**, not by checking 100 transactions.
- **The real goal is owner independence:** *"Can the business run for a day, then a week, without the owner in the vehicle, and without losing control?"*

## 2. Where the product stands today

A large part of your specification is already built and tested.

### Already working

- **Owner app** (phone and computer), with a control-tower dashboard covering cash, receivables, profit and alerts.
- **Driver app:** works offline, the driver sees only their own trip, with proof of delivery (signature or photo), cash collection, expenses and shortage reports.
- **Orders:** credit checks, holds and approvals.
- **Procurement from farmers:** lots, grading, KG traceability from farmer to customer.
- **Inventory:** reserved vs available, shrinkage and rejection write-offs.
- **Trips:** multi-drop, with driver-cash reconciliation (expected vs actual, mismatches flagged).
- **Receivables:** credit limits, payment terms, ageing, partial payments allocated oldest-first by default, optional finance charges, statements.
- **Farmer payables** with payment terms.
- **Full double-entry accounting:** journals, general ledger, trial balance, P&L, balance sheet, period close.
- **Vehicles:** fuel, maintenance, documents, depreciation, loans and EMIs, cost per vehicle.
- **Workforce:** attendance, piece rates, incentives, minimum wage, pay runs and approvals.
- **Crates:** issued, returned, lost.
- **Spot sales from the vehicle** (no prior order), which suits the micro-distributor model.
- **GST and TDS:** tax invoices, GSTR-1/3B data, e-invoice JSON. This isn't in your document, but it's legally required, so we've kept it.
- **AI suggestions** (buying quantity, pricing, load/route, unprofitable sales). Each comes with its evidence, and nothing changes until the owner accepts.
- **Multi-business SaaS:** sign-up with mobile number, 1-month free trial, then read-only until subscribed.

### Partly there

- **Exception engine:** the dashboard flags a set of exceptions, but not yet everything in your list.
- **Customer true profitability:** per-sale margin exists; full cost allocation (service time, finance cost) does not.
- **Working-capital view:** receivables, payables and cash flow exist; the 7/15/30-day cash forecast does not.
- **Driver app sections:** trip and expenses exist; earnings, settlements and trip history screens do not.
- **Device binding:** sessions are tied to the phone, but drivers sign in with a password, not a PIN.

### Not built yet

- **All external communication:** WhatsApp, SMS, AI voice calling, automatic invoice and statement sending.
- **Payment commitment ledger** ("I'll pay ₹50,000 tomorrow") with follow-up and escalation.
- **Payment reconciliation** from screenshots or UTR numbers.
- **Seasonality engine, receivable risk states, recovery capacity, customer scoring.**
- **Perishables:** product hierarchy (type → grade → cut/SKU), yield/processing (purchase KG vs saleable KG), shelf life and FEFO, cold-chain/temperature records, quarantine.
- **Owner day-off mode and trip delegation** with delegation levels.
- **Driver PIN sign-in, driver language choice, voice entry for drivers.**
- **Cross-dock / line-haul / backhaul planning.**
- **Disputes** (with finance pause), early-payment credit, internal capital-cost metric.

## 3. Points in the document that need your decision

The document combines several versions written at different times, and a few places disagree with each other or with what's built:

1. **Which business comes first?** The opening says chicken/meat is the new baseline; later sections are titled "Vegetable ERP". What will the first pilot customers trade? This decides whether yield/processing and cold chain are urgent or can wait.
2. **35 or 37 features?** Section 2 lists 35. The last part adds "Owner Independence & Delegation" and "Mobile-First Micro-Distributor Mode". We'll treat the list as 37 unless you say otherwise.
3. **Finance-charge formula.** Your spec uses an *annual* rate × overdue days ÷ 365 (e.g. 18% p.a.). Ours currently uses a *monthly* rate × days ÷ 30 (e.g. 2% per 30 days). We'll switch to your annual formula unless you prefer the monthly one.
4. **Default prices.** Your spec says products have *no* permanent default price; prices come only from real transactions. Today each product has a base price that pre-fills new orders. Should we remove it and pre-fill from recent actual prices instead?
5. **Units.** We support kg, g, crate, bag, dozen and unit. Do you also need *bird count* (live chicken bought by count and weight) or *pieces/trays* (eggs)?
6. **Exactly two apps.** You asked for two apps. We built one Android app with an Owner/Driver choice on its first screen, plus the same owner app in any browser. Is that acceptable as "two apps"?
7. **Owner doing the driving.** In the micro-distributor model, the owner often *is* the driver. Should one person use both modes with one login, recording their own deliveries in driver mode while keeping owner powers?

## 4. Services that need accounts and running costs

The AI communication features depend on outside providers. Each needs a business account (ideally in your company's name), has per-use charges, and has Indian rules to follow:

| Feature | What's needed | Notes |
|---|---|---|
| WhatsApp invoices, statements, reminders | WhatsApp Business Platform (Meta) via a provider | Verified business, pre-approved message templates, charged per conversation |
| SMS fallback | SMS provider + DLT registration | DLT (TRAI) registration of sender ID and templates usually takes 1–2 weeks |
| AI voice calls (orders, collections) | Telephony (e.g. Exotel or Plivo) + speech AI | Calling-hour, consent and recording-disclosure rules apply; per-minute cost; needs a language decision |
| Payment links in invoices | Payment gateway (e.g. Razorpay) | KYC, a small fee per payment |
| Automatic bank reconciliation | Bank statement feed or Account Aggregator | Can start with uploaded statements and screenshots |

## 5. Suggested order of work

For a business earning ₹2,000–3,000 a day, the system first has to be dependable on the road; automation adds value on top of that. I suggest:

1. **Pilot-ready micro-distributor:**
   - owner-as-driver;
   - owner day-off mode and trip delegation with levels 1–4;
   - driver PIN;
   - driver earnings, settlement and history screens;
   - exception-only morning dashboard;
   - the finance-charge formula aligned with your spec;
   - payment commitments recorded by hand;
   - product hierarchy and yield, if the pilot is chicken/meat.
2. **WhatsApp automation:** invoices, statements, due-date reminders, payment links; replies recorded as commitments; follow-up/escalation ladder (T−3 … T+30).
3. **AI collections and calling:** collection priority list, AI calls with commitments captured, payment reconciliation from screenshots/UTR, AI ledger assistant ("How much does ABC owe?").
4. **Intelligence and scale:** seasonality baselines, receivable risk states and recovery capacity, 7/15/30-day cash forecast, shelf life/FEFO and cold chain, cross-dock and backhaul.

## 6. Questions

### Business and pilot

1. What do the first pilot customers trade: chicken/meat, vegetables, or both? How many vehicles and drivers do they typically have?
2. Is there a target date for the pilot, and which features must be ready for it?
3. Which states/cities first? This decides the languages for the driver app and AI calls (Malayalam, Kannada, Tamil, Hindi, English…).

### Chicken/meat operations (if applicable)

4. Do pilot businesses buy live birds and process them, or buy dressed chicken? If they process, where (on the vehicle, at a shop, at a supplier)?
5. Should yield be tracked per batch (e.g. 100 kg live → 72 kg saleable), and is there a standard expected yield per product we can warn against?
6. Cold chain: will temperatures be entered by hand (driver/staff), or are there sensors in vehicles or cold rooms?

### Owner independence

7. Is the 4-level delegation right (delivery only → delivery + collection → procurement + delivery → full route operator)? Who may hold Level 3–4, and does it need owner approval each time or a standing permission?
8. Should a delegation expire automatically (end of trip, end of day)?
9. On a day off, what should alert the owner immediately (phone notification) and what can wait for the evening summary?

### Communication and AI

10. Do you already have a WhatsApp Business account or a preferred provider? Will each customer business use its own WhatsApp number, or one shared Morbeez number?
11. For AI calls: who should the call say it's from (the business or "Morbeez accounts")? When must the AI hand over to a human?
12. Which messages may go out automatically, and which need the owner's tap first? (Your spec allows reminders, statements and invoices automatically; please confirm.)

### Money

13. Finance charge: annual rate ÷ 365 as in your spec (replacing our monthly rate)?
14. Dispute handling: confirm that finance charges pause only on the disputed amount, and that an untouched dispute becomes a critical exception after 30 days.
15. Subscription: what monthly price should Morbeez charge after the free month, and should businesses pay in the app (e.g. Razorpay) from the start?

Once we have your answers, we'll confirm the first phase in detail before starting.

Best regards,
