Developer Questions & Answers — Final Pilot Decisions

1. Live birds in transit: should the driver record birds that die on the way?

Answer: No individual bird-count tracking.

The live-bird module is weight-based, using cage/crate weight.

The ERP should record:

Cage/crate ID, if required

Gross weight

Tare weight

Net live weight

Farm weighment

Retailer weighment

Weight difference

Shrinkage %

Purchase value

Sales value


Individual bird count or individual bird deaths should not be an operational calculation field.

Any loss during transit should be reflected through the difference between the farm and retailer weighments.


---

2. Should weight loss between farm and retailer be tracked as shrinkage?

Answer: Yes.

Weight Loss = Farm Net Weight − Retailer Net Weight

Shrinkage % = Weight Loss ÷ Farm Net Weight × 100

The Owner configures an acceptable shrinkage percentage.

If actual shrinkage exceeds the configured tolerance:

→ Owner Alert / Shrinkage Exception

The ERP should retain both weighments for reconciliation and audit.


---

3. How are live birds priced?

Answer: The pilot uses KG of live weight, not individual bird count.

The commercial quantity is the net cage/crate weight.

The ERP records:

Purchase Rate/kg × Farm Net Weight = Purchase Value

and:

Sales Rate/kg × Retailer Net Weight = Sales Value

The system should retain both farm and retailer weights because they may differ due to transit shrinkage.


---

4. Which weight is used for the purchase and which for the sale?

Answer:

Purchase: Farm weighment.

Sale: Retailer weighment.

Therefore:

Farmer settlement → Farm weight

Retailer invoice/sale → Retailer weight

The difference is recorded as shrinkage/transit weight loss.


---

5. Can live-bird pricing support other deal types later?

Answer: The architecture can be configurable for future commercial models, but the pilot standard is KG-based live-weight pricing.

Individual bird count should not become a core inventory or pricing dependency.


---

6. How are eggs purchased and sold?

Answer: Both piece and tray/crate should be supported.

The Owner configures the conversion.

Example:

1 tray = 30 eggs

The ERP should support:

Purchase by tray

Purchase by piece

Sale by tray

Sale by piece

Conversion between units

Returns

Breakage

Spoilage/loss



---

7. Should broken eggs be recorded?

Answer: Yes.

Broken eggs are recorded as inventory loss/breakage.

The Owner can configure an acceptable breakage tolerance.

If breakage exceeds the tolerance:

→ Quality/Loss Exception → Owner Review


---

8. Should products have a permanent default selling price?

Answer: No.

Remove the concept of a permanent hard-coded selling price as the financial truth.

Instead, when a new order is created, the ERP should pre-fill the most recent actual transaction price for that specific customer + product.

Example:

Customer A previously bought Tomato at ₹32/kg.

Next Tomato order for Customer A:

Suggested price = ₹32/kg

The Owner can then change it if required.


---

9. Is the most recent actual price the final price?

Answer: No.

It is only a suggested starting price.

The pricing engine can consider:

Recent purchase cost

Recent customer price

Market conditions

Customer history

Quantity

Target margin

Shrinkage

Route/service cost

Credit/finance cost

Seasonality


The final transaction price is recorded as the actual commercial price.

Historical transactions must never be silently changed.


---

10. Should the Owner App support Malayalam, Kannada and Tamil?

Answer: Yes.

The Owner App should support:

English

Malayalam

Kannada

Tamil


The Driver App should support the same languages.

The business/user should be able to select the preferred language.


---

11. Who should review translations?

Answer: Native-speaker review should be done before pilot release.

Recommended process:

AI/translation draft → Native speaker review → Developer implementation → Pilot user testing → Final terminology approval

Pilot businesses can provide native Malayalam, Kannada and Tamil speakers for practical review.

Business-specific agricultural/wholesale terminology should be reviewed carefully because literal translation may not be appropriate.


---

12. Does the minimum pilot require AI voice calling?

Answer: No.

WhatsApp AI communication is sufficient for the minimum pilot.

Phase 1:

AI + WhatsApp

Phase 2:

AI Voice Calling

Voice calling requires additional:

Telephony provider

Speech recognition

Text-to-speech

Language support

Consent handling

Call recording/audit requirements

Human handoff


Therefore it should not block the initial pilot.


---

13. What should AI communication cover in Phase 1?

Answer:

WhatsApp can handle:

Invoice sending

Statement sending

Payment reminders

Due-date reminders

Order confirmation

Delivery confirmation

Collection follow-up

Payment commitment

Routine customer communication

Basic customer responses


Sensitive commercial/financial decisions remain under Owner approval.


---

14. What WhatsApp setup does each pilot business need?

Answer:

Each business should have its own WhatsApp Business identity and number.

The number should be suitable for WhatsApp Business API onboarding and not remain tied to the ordinary WhatsApp setup in a way that prevents API use.

Morbeez should use a WhatsApp provider adapter, rather than tightly coupling the ERP to one provider.

Potential providers can include:

Meta Cloud API directly

Gupshup

Interakt


The final provider can be selected during pilot implementation based on cost, onboarding, API capability and language/operational requirements.


---

15. Who helps pilot businesses with Meta verification?

Answer: The Morbeez implementation/onboarding team should coordinate the process.

The pilot business provides the required:

Business details

Business verification documents

Phone number

Business information

Meta Business account access/authorization


Morbeez/developer team guides the business through the technical onboarding.


---

16. Does the pilot need two separate Android apps?

Answer: No.

The current approach is acceptable for the pilot:

One Android application → Secure Owner Mode / Driver Mode

Additionally:

Owner App → Browser/Web access

The logical architecture remains:

Owner App + Driver App + One Backend

Even if they are technically packaged together during the pilot.


---

17. Can a Driver switch to Owner mode?

Answer: No.

The Owner/Driver mode selection is not a security mechanism by itself.

Access must be controlled through:

Authentication

User role

Backend authorization

Permission matrix

Session/token control


A Driver must never gain Owner permissions simply by selecting “Owner” on the screen.


---

18. Can the system later become two separate apps?

Answer: Yes.

The pilot can use one Android package for speed and simplicity.

The backend should remain role-based so that later the system can split into:

Morbeez Owner App

and

Morbeez Driver App

without rebuilding the underlying ERP.


---

19. Can drivers hand over UPI/bank collections?

Answer: Yes, but the ERP must distinguish physical handover from account-level collection.

Three cases:

A. Cash collected by Driver

Driver collects cash → Driver physically hands cash to Owner.

B. Customer pays directly to Owner UPI/bank

No physical handover.

ERP records:

Customer → Owner Bank/UPI

and links it to the invoice/receivable.

C. Driver deposits cash directly into bank

Driver records:

Amount

Bank account

Deposit reference

Date/time

Source cash

Trip


The ERP reduces the driver's physical cash accordingly.


---

20. What is the final money-handover formula?

Answer:

Expected Cash Handover =

Opening Driver Cash

Cash Collections

Other Cash Receipts
− Approved Cash Expenses
− Bank Cash Deposits


Then:

Expected Cash Handover vs Actual Handover

Any difference becomes a reconciliation exception for the Owner.


---

Final developer instruction

The above decisions should be treated as the pilot baseline:

> Live chicken = cage/crate KG-based operation. No individual bird-count dependency. Farm weight for procurement, retailer weight for sale, difference tracked as shrinkage. Eggs = piece/tray with configurable conversion and breakage tracking. Prices = most recent actual customer/product transaction as suggestion, not permanent base price. Owner + Driver = multilingual. AI communication = WhatsApp first, voice later. WhatsApp identity = each business's own. Pilot = one secure Android app with Owner/Driver modes plus Owner web access. Money = cash, UPI, bank and direct bank deposits, all reconciled by Owner.