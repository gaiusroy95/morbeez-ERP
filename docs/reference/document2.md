**Subject: Re: Morbeez Q&A — confirmed scope for the pilot, plan, and a few last questions**

Hi,

Thank you for the clear answers. They settle most of the open points. Below is what we'll build for the pilot based on them, how it fits with what already exists, and a short list of remaining questions.

## 1. What we've confirmed

- **Business model:** farmer/supplier → owner as wholesaler → vehicle → retailer → delivery → invoice → collection → driver money handover → owner reconciliation → **owner closes the trip**.
- **Commodities:** vegetables first. Live chicken and eggs are additional scope.
- **Live chicken:** bought live from farmers and sold live to retailers. No processing, no yield engine, no cold chain.
- **Regions and languages:** Kerala, Karnataka and Tamil Nadu. The driver app and AI communication will support Malayalam, Kannada, Tamil and English.
- **Drivers:** owner-driver, employee drivers and backup drivers, with vehicles and drivers configurable per business.
- **Delegation:** the 4 levels as listed. The owner chooses eligible drivers, and can use standing permission or per-trip approval. Delegations expire automatically (end of trip, end of operating day, or a set date/time). Eligibility is kept separate from authorization for a specific trip.
- **Owner alerts:** important exceptions alert immediately; everything normal goes into the evening summary.
- **Communication:** each business uses its own WhatsApp Business number, and the AI speaks as that business ("calling from ABC Vegetables"). You've listed which messages may go out automatically, which actions need owner approval, and when the AI must hand over to a person.
- **Finance:** finance charge = outstanding principal × annual rate × overdue days ÷ 365, with partial payments reducing the principal immediately. A dispute pauses finance charges only on the disputed amount. A dispute untouched for 30 days becomes a critical exception, with no automatic write-off or reversal.
- **Trip closure:** the driver submits ("Trip completed, awaiting owner reconciliation"). Only the owner reconciles and closes, and can return the trip to the driver, hold it, approve it with an exception, or investigate.
- **Subscription:** the price is configurable and not fixed yet, with in-app payment through Razorpay.

## 2. How this fits what's already built

Most of the pilot list already works today:
- farmers/suppliers and retailers/customers;
- procurement with grading and lots;
- customer orders and pricing;
- trips, delivery and proof of delivery;
- collections, credit and receivables;
- driver cash and trip reconciliation;
- the offline driver app;
- the owner dashboard;
- audit trail;
- basic profitability.

What the pilot adds or changes:

| Area | Change |
|---|---|
| Trip closure | New driver **submit + money handover** step, and an owner reconciliation checklist (procurement, KG, deliveries, collections, handover, expenses, returns/shortages, exceptions) with **close / return to driver / hold / approve with exception** |
| Delegation | 4 authority levels, driver eligibility, standing vs per-trip approval, auto-expiry, owner day-off mode with trip handover |
| Owner-driver | One person can run a trip themselves in the Driver app and still close it as owner |
| Driver sign-in | PIN on the driver's own registered phone |
| Live chicken | Purchase and sale by **bird count and weight**; lots traced from farmer to retailer |
| Eggs | Purchase and sale by **trays/pieces** |
| Vehicle inventory | What's on the vehicle now: loaded, delivered, returned, remaining |
| Finance | Finance charge moves to the annual-rate ÷ 365 formula; disputes with a finance pause and a 30-day critical exception |
| Alerts | Immediate phone notifications for the listed exceptions, plus an evening summary |
| Languages | Driver app in Malayalam, Kannada, Tamil and English |
| WhatsApp | Each business connects its own number; invoices, statements, reminders and confirmations go out automatically within the owner's permissions; customer replies recorded against the account |
| Subscription | Configurable price, with payment by Razorpay inside the app |

## 3. Proposed order of work

Since there's no fixed pilot date, I'll work in this order so the most essential parts are usable first. I'll share a timeline once you confirm.

1. **Trip handover and owner closure:** driver submit and money handover, owner reconciliation checklist, return/hold/approve-with-exception; vehicle inventory.
2. **Delegation and day-off mode:** levels, eligibility, approvals, auto-expiry; owner-driver; driver PIN; immediate alerts and the evening summary.
3. **Live chicken and eggs:** count + weight and trays/pieces; plus the finance-charge formula and disputes.
4. **Languages:** Malayalam, Kannada and Tamil in the driver app.
5. **WhatsApp:** per-business numbers, automatic invoices, statements, reminders and confirmations, and payment commitments.
6. **Subscription payment** with Razorpay.
7. **AI voice calling:** after WhatsApp is running in the pilot (see question 6).

## 4. Remaining questions

1. **Live birds in transit:** should the driver record birds that die on the way (count and weight)? Should weight loss between the farm scale and the retailer's scale be tracked as shrinkage, with an expected loss % above which the owner is alerted?
2. **Live-bird pricing:** are birds priced per kg of live weight, per bird, or either, depending on the deal? Is the weight that counts the one taken at the farm, or at the retailer?
3. **Eggs:** do you buy and sell by tray (30 eggs), by piece, or both? Should broken eggs be recorded as a loss?
4. **Default prices:** your specification says products should have no permanent default price, with prices coming only from actual transactions. Today each product has a base price that pre-fills new orders. Should we remove it and pre-fill from the most recent actual price for that customer/product instead?
5. **App languages:** should the **owner** app also be available in Malayalam, Kannada and Tamil, or English only for the pilot? For the translations, can you or the pilot businesses provide a native speaker to review the wording before release?
6. **"AI communication" in the pilot:** does the minimum pilot need **AI voice calls**, or is **WhatsApp messaging** enough to start, with voice calls added after the pilot is running? Voice calling needs a telephony provider, speech technology for each language and consent handling, so it's a larger step.
7. **WhatsApp setup:** each pilot business will need a Meta-verified WhatsApp Business account and a number not already used on the regular WhatsApp app. Do you have a preferred WhatsApp provider (e.g. Gupshup, Interakt, Meta Cloud API directly)? Who will help the pilot businesses through Meta verification?
8. **Two apps:** today the Android app opens with a choice of Owner or Driver, and the owner app also runs in any browser. Is one Android app with two modes acceptable, or do you want two separate apps in the Play Store?
9. **Money handover:** besides cash, can a driver hand over UPI/bank collections, which are already in the owner's account? Should the handover also record cash the driver deposits directly into the bank?

Once these are answered, I'll start on the trip handover and owner closure workflow.

Best regards,
