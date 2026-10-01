**Subject: Re: Final pilot decisions — confirmed, and we're starting**

Hi,

Thank you. Your answers settle the pilot baseline, and we'll build to it exactly as written. Below is a short confirmation of how each decision lands in the product, the few defaults we'll use unless you say otherwise, and three last small questions.

## 1. Pilot baseline, as we'll build it

| Decision | In the product |
|---|---|
| **Live chicken** | Weight-based only, no bird count. Each weighment records cage/crate (optional), gross, tare and net live weight. **Farm weighment** prices the purchase and settles the farmer. **Retailer weighment** prices the sale and invoice. The difference is recorded as transit shrinkage. |
| **Shrinkage tolerance** | Owner sets an acceptable %. Above it, the trip shows a shrinkage exception and the owner is alerted. Both weighments are kept for audit. |
| **Eggs** | Bought and sold by piece or tray, with the conversion set by the owner (e.g. 1 tray = 30). Returns, breakage and spoilage are recorded as losses; breakage above the owner's tolerance becomes an exception for review. |
| **Prices** | No permanent base price. A new order line suggests the **last actual price for that customer and product**; the owner can change it. The price actually used is stored with the order and invoice, and past transactions are never changed. |
| **Languages** | Owner and Driver apps in English, Malayalam, Kannada and Tamil, chosen per user. Process: draft translation → native-speaker review by the pilot businesses → build → pilot testing → final terminology approval. |
| **AI communication** | Phase 1 is WhatsApp: invoices, statements, payment and due-date reminders, order and delivery confirmations, collection follow-up, payment commitments, routine replies. Sensitive decisions stay with the owner. AI voice calling is Phase 2. |
| **WhatsApp** | Each business uses its own number and identity. The ERP talks to WhatsApp through a replaceable provider adapter, so Meta Cloud API, Gupshup or Interakt can be chosen during pilot onboarding. The Morbeez team coordinates Meta verification; the business provides documents and access. |
| **Apps** | One secure Android app with Owner and Driver modes, plus the owner app in the browser. Choosing "Owner" on screen grants nothing: every action is checked on the server against the signed-in user's role and permissions. A later split into two Play Store apps needs no backend changes. |
| **Money handover** | Three separate cases: (A) cash collected by the driver and handed to the owner; (B) customer paid directly to the owner's UPI/bank, with no handover, linked to the invoice; (C) cash the driver deposits into the bank, with amount, account, reference, date/time and trip. **Expected handover = opening driver cash + cash collections + other cash receipts − approved cash expenses − bank deposits.** Any difference with the actual handover is a reconciliation exception for the owner. |

## 2. Defaults we'll use unless you say otherwise

- **Shrinkage and breakage tolerance** is set per product, with one business-wide default the owner can override per product.
- **A price suggestion for a customer's first order of a product** uses the most recent price for that product to any customer. If the product has never been sold, the price starts empty.
- **Cage tare** is entered at each weighment (gross and tare per cage, or totals for a batch of cages).
- **GST returns, tax invoices and accounting statements** keep English as their official text, alongside the user's chosen language for the app itself. (See question 1.)

## 3. Three last questions

1. **Customer-facing language:** should invoices, statements and WhatsApp messages go out in each **retailer's** preferred language (set on the customer record), or in the business owner's language? Is English acceptable on tax invoices, with the local language used in WhatsApp messages?
2. **Cage tare:** does each business use cages with a known, fixed empty weight (we could register cages once and fill in the tare automatically), or do weights vary enough that the empty cage must be weighed every time?
3. **Retailer weighment:** who weighs at the retailer: the driver on a scale carried in the vehicle, or the retailer's own scale? If it's the retailer's scale, should the driver photograph the reading as proof?

## 4. Next step

We're starting with the first part of the pilot: **trip handover and owner closure**:
- driver submits the trip ("completed, awaiting owner reconciliation");
- money handover in all three cases above;
- the owner's reconciliation checklist;
- close / return to driver / hold / approve with exception;
- vehicle inventory.

Delegation and day-off mode come next, followed by live chicken weighments and eggs, then languages, then WhatsApp.

I'll send an update with screenshots when the first part is ready for you to try.

Best regards,
