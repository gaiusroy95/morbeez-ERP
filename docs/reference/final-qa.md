Here is the clean final Q&A exactly for sending to the developer, with your latest corrections incorporated.

Morbeez ERP — Developer Questions & Answers

A. Business & Pilot

Q1. What do the first pilot customers trade: chicken/meat, vegetables, or both?
A: Vegetables are the primary pilot business. Chicken and eggs are additional scope. The core business model is farmer/supplier → owner as wholesaler → retailer.

Q2. What is the actual role of the Owner?
A: The Owner acts as the wholesaler/trader. The Owner buys from farmers/suppliers and sells to multiple retail customers. The complete operation is managed through the ERP.

Q3. How many vehicles and drivers do pilot businesses typically have?
A: The target is small, vehicle-based businesses. The ERP must support owner-driver, employee drivers and backup drivers, with multiple vehicles as the business grows. Vehicle/driver count must be configurable per business.

Q4. Is there a target date for the pilot?
A: No specific date has been fixed yet.

Q5. Which features must be ready for the pilot?
A: The minimum pilot must cover:

Owner configuration

Farmer/supplier management

Retailer/customer management

Procurement

Purchase quantity/KG

Quality/grade

Lot tracking

Vehicle inventory

Customer orders

Pricing

Delivery

POD

Customer collections

Credit/receivables

Driver cash

Trip management

4-level driver delegation

Money handover

Owner reconciliation

Owner trip closure

Basic profitability

Offline Driver App

Owner Control Tower

AI communication

Audit trail



---

B. Geography & Languages

Q6. Which states/cities come first?
A: Kerala, Karnataka and Tamil Nadu. Exact cities/markets are configurable per pilot business.

Q7. Which languages are required?
A: Driver App and AI communication should support:

Malayalam

Kannada

Tamil

English



---

C. Chicken Operations

Q8. Do pilot businesses buy live birds and process them, or buy dressed chicken?
A: They buy live birds from farmers and sell them directly to retailers. We do not process the birds.

Q9. Where does chicken processing happen?
A: It does not happen within the Morbeez operation. Processing is outside our scope.

Q10. How many live-bird businesses are included in the pilot?
A: 3 live-bird businesses.

Q11. Should yield be tracked per batch?
A: No for chicken. Since we don't process the birds, processing yield is not required.

Q12. What should be tracked for live birds?
A:

Farmer → Purchase → Quantity/Weight → Rate → Lot/Source → Vehicle → Retailer → Sale → Delivery → Collection → Reconciliation.

Q13. Is cold chain required?
A: No. Cold chain is not required for the pilot.


---

D. Owner Independence & Delegation

Q14. Is the 4-level delegation model correct?
A: Yes.

Level	Driver authority

Level 1	Delivery + POD
Level 2	Delivery + Collection
Level 3	Procurement + Delivery + Collection
Level 4	Full route operator


Q15. Who can hold Level 3–4?
A: The Owner decides which drivers are eligible.

Q16. Does every delegation require Owner approval?
A: The system must support both standing permission and specific trip approval. The Owner configures which model applies.

Q17. Should delegation expire automatically?
A: Yes.

Trip delegation → ends with the trip/handover

Day-off delegation → ends at the configured operating-day end

Temporary delegation → ends at configured date/time


Standing driver eligibility is separate from actual trip authorization.


---

E. Owner Day-Off

Q18. What happens when the Owner takes a day off?
A: The Owner assigns the trip to an eligible backup driver. The Driver receives the vehicle, route, procurement tasks, customer deliveries and collection requirements.

The Owner can manage the operation remotely.

Q19. What should alert the Owner immediately?
A: Only important exceptions:

Major cash mismatch

Major KG/inventory mismatch

Serious customer rejection

Major procurement issue

Driver unable to continue

Significant collection discrepancy

Serious operational problem

Security issue

Trip unable to proceed


Q20. What can wait for the evening summary?
A: Normal:

Procurement

Deliveries

Collections

Expenses

Remaining inventory

Customer activity

Driver activity

Normal trip economics


Principle:

Normal = summary. Exception = immediate alert.


---

F. Communication & AI

Q21. Should each business use its own WhatsApp number?
A: Yes. Each business should be able to connect/use its own WhatsApp Business number. Morbeez is the underlying ERP platform.

Q22. What should the AI say it is calling from?
A: The AI should normally represent the customer's own business.

Example:

> “Good morning, I'm calling from ABC Vegetables regarding your account.”



Not normally:

> “I'm calling from Morbeez Accounts.”



Q23. When must AI hand over to a human?
A: For:

Disputes

Serious complaints

Legal issues

Major quality complaints

Price negotiation outside authority

Credit-limit requests

Finance waivers

Write-offs

Major payment discrepancies

Low AI confidence

Customer specifically requests a human/Owner


Q24. Which messages can go automatically?
A: With Owner-configured permissions:

Invoice

Statement

Payment reminder

Due-date reminder

Order confirmation

Delivery confirmation

Routine collection follow-up

Payment commitment follow-up

Routine notifications


Q25. Which actions require Owner approval?
A: Normally:

Price override

Special discount

Credit-limit change

Write-off

Finance waiver

Dispute settlement

Major compensation

Inventory write-off

Significant financial adjustment



---

G. Money & Finance

Q26. How should finance charges be calculated?
A: Annual rate ÷ 365.

Formula:

Outstanding Principal × Annual Rate × Overdue Days ÷ 365

Partial payments immediately reduce the outstanding principal.

Q27. What happens when a customer disputes part of an invoice?
A: Finance charges pause only on the disputed amount. The undisputed amount continues under the normal receivable/finance policy.

Q28. What happens if a dispute remains untouched for 30 days?
A: It becomes a Critical Exception for Owner review.

There is no automatic write-off or automatic accounting reversal.


---

H. Trip Closure

Q29. Who closes the trip?
A: Only the Owner.

The Driver executes the trip, hands over the money and submits the trip for reconciliation.

Q30. What happens before trip closure?

A:

Driver:

1. Completes procurement


2. Completes deliveries


3. Records collections


4. Records expenses


5. Hands over money


6. Submits trip



Then Owner:

1. Reconciles procurement


2. Reconciles inventory/KG


3. Reconciles deliveries


4. Reconciles collections


5. Reconciles money handover


6. Checks expenses


7. Checks returns/shortages


8. Checks exceptions


9. Approves and closes



Q31. What is the Driver's status after completing the trip?
A:

> Trip Completed — Awaiting Owner Reconciliation



The Driver cannot finally close the trip.

Q32. What happens if reconciliation does not match?
A: Owner can:

Return to Driver for correction

Hold the trip

Approve with exception

Investigate


Nothing silently closes.


---

I. Subscription

Q33. What is the monthly subscription price after the free month?
A: Not finalized yet. Keep the subscription price configurable.

Q34. Should payment happen inside the app?
A: Yes. The architecture should support in-app subscription payment, including Razorpay.

The final subscription pricing can be decided after pilot validation.


---

FINAL BUSINESS MODEL FOR DEVELOPMENT

FARMER / SUPPLIER
        ↓
   PROCUREMENT
        ↓
OWNER / WHOLESALER
        ↓
     VEHICLE
        ↓
     RETAILER
        ↓
    DELIVERY
        ↓
     INVOICE
        ↓
    COLLECTION
        ↓
 DRIVER MONEY HANDOVER
        ↓
 OWNER RECONCILIATION
        ↓
 OWNER CLOSES TRIP

Pilot priority

Vegetables = Primary

Live chicken = Additional scope

Eggs = Additional scope

Chicken model

Farmer → Live Bird Purchase → Wholesaler → Retailer

No processing. No yield engine. No cold-chain requirement.

Core operating principle

> Owner decides. Driver executes. ERP calculates. AI communicates and assists. Driver hands over. Owner reconciles and closes.