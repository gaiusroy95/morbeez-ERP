<!-- Unified Final Master Specification (65 sections) — as the client sent it, 9 Nov 2026. Kept verbatim; the plan is docs/redesign/master-spec-v3-plan.md. -->

MORBEEZ VEGETABLE ERP — UNIFIED FINAL MASTER SPECIFICATION

> Simple SOP. Simple Driver App. Powerful Owner App. Powerful Backend.
Owner decides. Driver executes. ERP calculates.
One business. Two apps. One database. One source of truth.




---

1. SYSTEM ARCHITECTURE

Exactly 2 apps

1. Morbeez Owner App — Control Tower
Controls commercial decisions, procurement, customers, trips, finance, workforce, vehicles, profitability, AI and exceptions.

2. Morbeez Driver App — Field Execution
Handles only the physical work assigned to the driver.

One backend

PostgreSQL/database

API/Auth

Event Engine

Inventory Engine

Finance Engine

Cost Engine

Workforce & Service Effort Engine

Accounting Engine

Fixed Asset Engine

Loan/EMI Engine

AI Engine

Exception Engine

WhatsApp/Notification Engine

Offline Sync Engine

Audit Engine


The backend contains the complexity. The apps expose only what the user needs to do.


---

2. COMPLETE BUSINESS PROCESS

MARKET / CUSTOMER DEMAND
        ↓
CUSTOMER ORDER
        ↓
PRICE + CREDIT + DELIVERY DECISION
        ↓
DEMAND / INVENTORY / MARKET ANALYSIS
        ↓
PROCUREMENT REQUIREMENT
        ↓
FARMER / AGENT / MARKET PROCUREMENT
        ↓
QUALITY + WEIGHMENT
        ↓
LOT CREATION
        ↓
AGGREGATION / CONSOLIDATION
        ↓
VEHICLE + ROUTE + LOAD PLANNING
        ↓
PROCUREMENT PICKUP
        ↓
VEHICLE INVENTORY
        ↓
LINE-HAUL / CROSS-DOCK IF REQUIRED
        ↓
LAST-MILE DISTRIBUTION
        ↓
CUSTOMER DELIVERY + POD
        ↓
COLLECTION
        ↓
QUALITY / SHORTAGE / REJECTION / DISPUTE
        ↓
INVENTORY + SHRINKAGE RECONCILIATION
        ↓
CUSTOMER / FARMER FINANCE
        ↓
WORKFORCE CALCULATION
        ↓
VEHICLE ECONOMICS
        ↓
TRIP RECONCILIATION
        ↓
ACCOUNTING
        ↓
TRUE COST + PROFITABILITY
        ↓
AI + EXCEPTIONS
        ↓
OWNER DECISION


---

3. TRANSPORT SCALING MODEL

Morbeez must not depend on one vehicle size.

Feeder

Farmer → Aggregation

Small vehicle / short radius.

Line-haul

Aggregation → Destination

Large truck with high utilization.

Last-mile

Destination → Customer clusters

Small/medium vehicles.

Cross-dock

Large Truck
   ↓
Virtual / Partner Cross-Dock
   ↓
Small Vehicles
   ↓
Customer Clusters

Cross-dock is a planning/execution capability, not a separate app.

ERP compares:

Direct delivery

Consolidated transport

Cross-dock

Vehicle capacity

Route density

Last-mile utilization

Line-haul utilization

Backhaul

Contribution/vehicle-day

Cost/KG


Do not purchase large vehicles merely because their ₹/ton is cheaper. Volume density and utilization must justify dedicated capacity.


---

4. OWNER APP

Footer

Dashboard | Procurement | Delivery | Trips

Side Menu

BUSINESS

Customers

Farmers

Inventory


FINANCE

Finance

Profit


RESOURCES

Workforce

Vehicles


CONTROL

AI

Approvals & Exceptions

Reports


SYSTEM

Settings

Profile

Help


No duplicated modules.

Collections → Finance/Delivery
Settlements → Finance
Expenses → Trip/Finance
Customer profitability → Profit
Price trends → Reports/Product
Price movers → Dashboard
Disputes → Approvals & Exceptions
Notifications → Header/Bell
Route/procurement/delivery stops → Trips


---

5. DRIVER APP

Footer

Dashboard | Procurement | Delivery

Side Menu

TRIP

Trip History


MY

Earnings

Settlements

Driver Cash


SYSTEM

Sync

Help

Profile

Language

Logout


Expense, collection, workforce, vehicle and backhaul are contextual actions inside the active trip.

Driver should almost never navigate during a trip.


---

6. UI PRINCIPLES

Owner

Create → Review → Confirm

Plan → Check → Publish

Alert → Review → Approve

Trip → Reconcile → Close

Driver

Next Action → Record → Complete

Rules:

One task = one screen

One decision = one confirmation

One physical event = one record

Known information is automatic

Calculated information comes from ERP

New physical reality is entered by user

Commercial decisions belong to Owner

Physical execution belongs to Driver


Driver should not re-enter:

Driver name

Vehicle

Trip ID

Farmer/customer identity

Route

Date

Product

Purchase rate

Selling price



---

7. OWNER SOP

1. Create/Confirm Procurement

Farmer, product, quantity, unit, purchase rate, pickup date, driver, optional agent/commission.

2. Create Customer Order

Customer, product, quantity, unit; review AI Customer-Specific Price and AI Average Price; confirm final price.

3. Build Trip

Route, vehicle, driver, crew, procurement stops, customer deliveries.

4. Check Trip

Capacity, driver, quantities, procurement, deliveries, collections, route.

5. Publish Trip

Driver receives assigned information only after publication.

6. Monitor

Pickup, vehicle inventory, deliveries, collections, route, exceptions.

7. Approve

Expenses, adjustments, settlements, exceptions, commercial overrides, incentives where applicable.

8. Handle Problems

Quality, shortages, rejection, cash mismatch, delays, credit, customer/farmer disputes.

9. Reconcile

KG, inventory, money, cash, workforce, vehicle, trip, workload, accounting.

10. Handover/Close

Confirm complete/reconciled and expire sensitive Driver access.


---

8. DRIVER SOP

1. Open published trip.


2. Check vehicle, opening KM, fuel, condition and crew.


3. Next pickup.


4. Arrive → actual KG → photo → accept/reject.


5. Load and complete pickup.


6. Next delivery.


7. Deliver actual KG + POD.


8. Collect payment when required.


9. Record expense/workforce/backhaul.


10. Closing KM + cash + vehicle issue → submit trip.



Driver Golden Rule

> If it physically happened, record it. If it is commercial or financial, send it to Owner.



Owner Golden Rule

> If it changes money, commercial terms, credit, profitability or business liability, Owner approves it.




---

9. CUSTOMER DEMAND → ORDER

Customer order contains:

Customer

Product

Quantity

Unit

Selling ₹/KG

Delivery requirement

Payment terms

Credit status


ERP considers:

Existing inventory

Reserved inventory

Procurement requirement

Market price

Customer economics

Route

Service effort

Credit

Finance cost



---

10. PROCUREMENT PLANNING

ERP combines:

Customer demand + expected demand + inventory + market price

to determine:

Required KG

Shortage

Procurement requirement

Source options

Farmer availability

Route compatibility

Vehicle requirement


Owner confirms procurement.


---

11. PROCUREMENT

Required:

Farmer

Product

Quantity

Unit

Purchase ₹/KG

Pickup date

Driver


Optional:

Agent

Commission/KG


Purchase rate is Owner-negotiated.

Lifecycle

DRAFT
→ CONFIRMED
→ ASSIGNED
→ PICKUP
→ PARTIALLY PICKED
→ PICKED UP
→ SETTLED

Agent commission:

Verified KG × Commission/KG

No agent = ₹0.


---

12. FARMER MASTER

Stores:

Name

Mobile

GPS

Products

Payment terms

Bank/UPI

Procurement history

Purchased

Paid

Outstanding

Average payment days

Overdue

Payment history

Disputes


Terms:

Immediate, Bill-to-Bill, Net 3/7/10/15/20/30/45/60 or Custom.


---

13. PRODUCT MASTER

Contains:

Product

Base unit

KG/BAG

Bag weight

Optional crate weight

Active/inactive


No fixed default purchase price, selling price or market price.

Actual transactions create the market-price intelligence.


---

14. PRICE ENGINE

Purchase transaction:

Product + Date + Market/Route + Farmer + KG + Purchase Rate

Sale transaction:

Product + Date + Market/Route + Customer + KG + Selling Rate

Weighted average:

Σ(Price × KG) / ΣKG

Price Trend appears exactly in 3 places

Product → Trend

Default 30 days

Purchase/Selling/Both

Average purchase

Average selling

Spread

Volume


Dashboard → Price Movers

Top 5 day-over-day movers


Reports → Price Trends

Product

Route

Market

Farmer

Customer

Date



---

15. CUSTOMER PRICING

Owner sees:

Current economics

AI Customer-Specific Price

AI Average Price

Service effort

Historical profitability

Workload

Credit

Finance cost

Recommendation


AI considers:

Product cost

Purchase rate

Agent

Packaging

Labour

Driver

Incentives

Vehicle

Distance

Route

Shrinkage

Rejection

Customer history

Payment behaviour

Credit period

Finance cost

Market price

Current trip economics


AI can recommend:

Selling price

Minimum order

Minimum order value

Delivery/service charge

Consolidation

Schedule

Route


Owner approves final price.


---

16. MINIMUM SUSTAINABLE PRICE

ERP should calculate a commercial floor based on:

Product cost + attributable operating cost + shrinkage/rejection + applicable finance cost + required contribution

If Owner sells below the calculated floor:

Exception / warning

Owner can override with audit trail.


---

17. CUSTOMER ECONOMICS

Customer Value

Revenue

KG

Revenue/order

Revenue/KG


Customer Resource Consumption

Rolling 30-day verified:

Service minutes

Waiting

Unloading

Weighing

Collection

Distance

Stops

KG

Crates

Lots

Complexity


Concept:

Customer Economic Efficiency = Revenue ÷ Verified Service/Delivery Resource Time

This is an AI input, not an automatic final pricing formula.

Customer value never determines service quality.


---

18. ROUTE

Route is a recurring corridor.

Contains:

Farmers

Customers

Procurement stops

Delivery stops

Vehicles

Drivers

Trips



---

19. TRIP

Trip contains:

Route

Vehicle

Driver

Crew

Opening KM

Closing KM

Procurement

Inventory

Orders

Deliveries

Collections

Expenses

Backhaul

Cash

Workforce

Workload

Exceptions

Profitability

Accounting


Planning uses:

Orders

Procurement

Inventory

Vehicle capacity

Driver availability

Route

Delivery windows

Backhaul

Load utilization

Workforce

Economics



---

20. TRIP DURATION & SERVICE EFFORT

Record:

Expected duration

Actual start

Actual finish

Actual duration

Variance

Arrival

Service start

Service complete

Departure

Waiting

Unloading

Weighing

Collection

POD

Travel time


Classify delay as:

Customer waiting

Procurement waiting

Traffic/route

Vehicle

Driver

Additional delivery

Other verified reason


Do not automatically classify every delay as customer-caused.


---

21. INVENTORY

No permanent warehouse is required.

Inventory can physically exist on:

Vehicle

Hub

Cross-dock

Approved location


Each lot stores:

Procurement

Farmer

Product

Purchase rate

Verified KG

Trip

Vehicle

Pickup event

Quality status


States:

Physical

Reserved

Available = Physical − Reserved

Reservation does not consume physical stock.

Delivery consumes physical stock.


---

22. QUANTITY ENGINE

Users may enter:

KG

BAG


Backend stores:

Integer grams

Money:

Integer paise

Conversions come from Product Master.

No intermediate rounding.


---

23. LOT TRACEABILITY

CUSTOMER
↓
DELIVERY
↓
LOT
↓
PROCUREMENT
↓
FARMER

Every KG is traceable.


---

24. SHRINKAGE / REJECTION

Example:

Purchased = 1,000 KG

Saleable = 950 KG

True cost is allocated over 950 KG.

Track separately:

Shrinkage

Rejection

Damage

Weight mismatch

Quality loss



---

25. BULK OPERATIONS

For bulk loading, do not pretend every KG can always be assigned to an individual worker.

Three measurement levels:

LOT

Bulk KG traceability.

EVENT

Bulk loading/receiving/dispatch and variance.

INDIVIDUAL

Only where responsibility is genuinely measurable.

Bulk KPI:

Loading accuracy

Weight variance

Loading time

Damage/shrinkage

Lot integrity

Vehicle utilization

Transfer variance


If individual responsibility cannot be established:

Business/operational loss — not employee penalty.


---

26. CROSS-DOCK

Supports:

Large truck inbound

Transfer

Lot continuity

Small-vehicle dispatch

Outbound KG

Variance

Handling cost

Transfer time


No separate cross-dock app is required.


---

27. CUSTOMER DELIVERY

NEXT CUSTOMER
↓
NAVIGATE
↓
ARRIVE
↓
DELIVER ACTUAL KG
↓
POD
↓
COLLECTION
↓
COMPLETE

Supports:

Partial delivery

Shortage

Rejection

Quality issue

Multi-lot delivery

Collection

Crate return



---

28. CUSTOMER DISPUTE

COMPLAINT
↓
CLASSIFICATION
↓
EVIDENCE
↓
LOT / WORKFORCE TRACE
↓
OWNER REVIEW
↓
RESPONSIBILITY
↓
RESOLUTION

Reasons:

Rotten

Damaged

Undersize

Mixed quality

Poor freshness

Other


Evidence:

Pickup photo

Packing photo

Loading photo

Delivery photo

POD

Weight

GPS

Timestamp

Lot

Customer statement/photo

Workforce statement


Customer complaint alone never creates a workforce deduction.


---

29. QUALITY ACCOUNTABILITY

FARMER
↓
PROCUREMENT
↓
LOT
↓
LOADER
↓
PACKER
↓
DRIVER
↓
CUSTOMER

Typical responsibility:

Bad before loading → procurement/source

Packing damage → packer

Loading damage → loader

Transport damage → driver

Wrong quantity → driver

Mixed grade → packer/loader

After customer takes control → no workforce penalty


Shared responsibility can be assigned by Owner with evidence and reason.

Only one penalty per dispute ID.

Quality compensation affects:

Customer True Cost / Trip Profitability

Workforce KPI affects:

Variable incentive only


---

30. CUSTOMER FINANCE

INVOICE
↓
TERMS
↓
DUE DATE
↓
OUTSTANDING
↓
PARTIAL PAYMENT
↓
ALLOCATION
↓
BALANCE
↓
RECEIPT

Supports:

Immediate

Bill-to-Bill

Net 7/10/15/20/30/45/60

Custom


Also:

Credit limit

Payment method

Finance charge ON/OFF

Annual rate


Unlimited partial payments.

FIFO default.

Owner override allowed.


---

31. FINANCE COST

Internal:

Outstanding × Annual Cost of Capital ÷ 365 × Days Outstanding

Partial payment reduces future finance cost.

Customer-facing finance charge is separately configurable.

Default planning rate:

18% p.a.

Only beyond agreed terms.


---

32. DISPUTE FINANCE

If dispute opens:

Disputed amount finance accrual pauses.

Full acceptance:

Accepted portion stops permanently.

Partial acceptance:

Accepted portion stops; rejected portion accrues from original due date.

Rejected dispute:

Full amount accrues from original due date.

No Owner action for 30 days:

Accrual resumes from dispute date + Critical Exception.

No automatic write-off.


---

33. CUSTOMER SCORING

Payment Score:

0–100

Customer Score:

Payment Behaviour — 35%

Profitability — 25%

Order Quality — 15%

Credit Risk — 15%

Operational Reliability — 10%


New customers:

Provisional / Insufficient History

Operational reliability may consider:

Delivery readiness

Waiting

Failed deliveries

Repeated disruptions

Excess service requirements


One unusual incident must not automatically distort the score.


---

34. CUSTOMER TRUE COST

Includes:

Purchase

Agent

Packaging

Packer

Loader

Applicable driver cost

Applicable driver incentive

Other workforce

Vehicle-attributable cost

Shrinkage

Rejection

Other attributable costs

Finance cost


Important

Normal driver base compensation is not automatically divided among customers.

Customer-specific verified workload incentive may be attributed.


---

35. PROFITABILITY

Operating Contribution

Revenue
− Product Purchase
− Agent
− Labour
− Fuel
− Toll
− Delivery Cost
− Shrinkage
− Rejection
− Other Attributable Cost
=
Operating Contribution

Then:

Operating Contribution − Finance Cost = Net Contribution After Finance

Hierarchy:

Business → Route → Trip → Vehicle → Product/Procurement → Customer/Order


---

36. CUSTOMER PROFITABILITY

Display:

Revenue

KG

Revenue/KG

True Cost

True Cost/KG

Contribution

Contribution/KG

Net Margin

Finance Cost

Service Minutes

Waiting Minutes

Workload

Workload Incentive

Contribution/Service Minute

Revenue/Service Minute

Contribution/Stop

Profit Leakage

AI Recommended Price



---

37. WORKFORCE ENGINE

Roles:

Driver

Assistant

Loader

Packer

Unloader

Sorter

Temporary helper

Casual worker


Lifecycle:

POOL → AVAILABILITY → ASSIGNMENT → WORK → EARNING → SETTLEMENT

Casual workers do not require login.


---

38. WORKFORCE PAY STRUCTURE

Keep separate:

Base

Payment for assigned work.

KG Incentive

Verified physical productivity.

KPI

Correct work.

Monthly Productivity

Consistent output.

Retention

Reliable participation.

Quality Accountability

Variable adjustment only after verified responsibility.


---

39. OWNER-CONFIGURED MONEY

No monetary incentive is hard-coded.

Owner configures:

Base trip/day

KPI

New customer

Turnover

KG

Trip bonus

Consistency

Retention

Loader

Packer

Collection

Backhaul

Mileage

Crate

Quality

Night duty

Data quality

Trip completion

Workload/service effort

Other incentives


Can configure:

₹

%

Slabs

Eligibility

Effective dates

Conditions

Caps where specifically desired



---

40. DRIVER GROWTH ECONOMICS

BASE TRIP
+
KPI
+
NEW CUSTOMER
+
CUSTOMER TURNOVER
+
CUSTOMER KG
+
MONTHLY PRODUCTIVITY
+
CONSISTENCY / RETENTION
+
OTHER APPROVED INCENTIVES

Growth incentives have no artificial ceiling.

New Customer

Requires genuine customer + qualifying transaction.

Turnover

Verified customer sales turnover continuously increases eligible earning.

KG

Verified customer delivery/handling KG continuously increases eligible earning.

Track independently:

Customer acquisition

Customer turnover

Customer KG


> Bring more customers → generate more turnover → deliver more KG → earn more.



Artificial customers, duplicate orders, duplicate KG and artificial delivery splitting do not qualify.


---

41. LOADER

Owner-configured:

Base/day

KG

Work-day bonus

KPI


KPI:

Loading accuracy 30%

Damage-free handling 30%

KG accuracy 20%

Discipline/time 10%

Safety 10%



---

42. PACKER

Owner-configured:

Base

KG

KPI

Bonus


KPI:

Packing quality 30%

Grade/lot accuracy 25%

Damage-free packing 20%

Quantity/weight accuracy 15%

Discipline/time 10%


Same person doing Loader + Packer:

One worker + one base + applicable combined rate/KPI

No duplicate payment for identical KG.


---

43. WORKFORCE ACCOUNTING

Approved incentive:

Workforce Incentive Expense Dr → Workforce Payable Cr

Payment:

Workforce Payable Dr → Bank/Cash Cr

Customer-attributable workload incentive can be linked:

Customer → Order → Delivery → Trip


---

44. WORKFORCE DASHBOARD

Driver

Trips

Base

KPI

Monthly bonus

Consistency

Retention

Complaints

Disputes

KG

Deliveries

Collections

Cash mismatch

Final payable


Loader

Days

Base

KG

KG incentive

Bonus

Damage

Disputes

KPI

Final payable


Packer

Days

Base

KG

KG incentive

KPI

Disputes

Damage

Grade/lot errors

Final payable



---

45. VEHICLE ECONOMICS

Vehicle master:

Purchase price/date

On-road cost

Modifications

Financing

Useful life

Useful KM

Residual value

Book value

Accumulated depreciation

Current KM

Lifetime KM


True cost/KM:

Fuel

Maintenance

Tyres

Depreciation/wear

Insurance

Permit/tax

Other costs


Modes:

Component Mode

ERP calculates.

All-In Mode

Owner configures ₹/KM.

No double counting.


---

46. MAINTENANCE

Track:

Oil

Filters

Brakes

Clutch

Tyres

Battery

Coolant

Alignment

Balancing

Service

Other


Due by:

Date OR KM, whichever comes first.


---

47. FIXED ASSETS / LOANS

Separate:

Accounting value

Cost − accumulated depreciation = NBV

Financing

Loan − principal repayment = outstanding

Operating economics

Fuel + maintenance + tyres + insurance + depreciation/wear + attributable cost

Cash

Down payment + EMI + operating payments + sale proceeds + loan settlement

Example:

Vehicle ₹12L
Down payment ₹3L
Loan ₹9L

Asset = ₹12L
Cash = ₹3L
Loan = ₹9L

₹25,000 EMI:

₹18,000 principal

₹7,000 interest


Loan Liability Dr       ₹18,000
Interest Expense Dr     ₹7,000
      Bank/Cash Cr      ₹25,000

Depreciation:

Depreciation Expense Dr
      Accumulated Depreciation Cr

Depreciation affects profit/NBV, not cash.


---

48. OPERATIONAL LEDGERS

1. Product Ledger


2. Money Ledger


3. Asset Ledger


4. Workforce Ledger


5. Trip Ledger


6. Driver Cash Ledger




---

49. ACCOUNTING SYSTEM

Additional:

7. General Ledger


8. Accounts Receivable


9. Accounts Payable


10. Fixed Asset Register


11. Loan Register


12. Depreciation Register


13. Chart of Accounts


14. Journal Engine


15. Financial Reporting Engine



Automatic double-entry from source events.

Authorized accounting users may create controlled manual journals.


---

50. ACCOUNTING ENTRIES

Sale:

Receivable Dr → Sales Cr

Collection:

Bank/Cash Dr → Receivable Cr

Farmer purchase:

Inventory Dr → Farmer Payable Cr

Farmer payment:

Payable Dr → Bank/Cash Cr

Fuel:

Fuel Expense Dr → Bank/Cash Cr

EMI:

Loan Liability Dr + Interest Expense Dr → Bank/Cash Cr

Depreciation:

Depreciation Expense Dr → Accumulated Depreciation Cr


---

51. FINANCE MODULE

Owner Finance contains:

Finance Dashboard

Receivables

Payables

Collections

Payments

Settlements

Working Capital

General Ledger

Trial Balance

P&L

Balance Sheet

Cash Flow

Chart of Accounts

Journal Entries

Fixed Assets

Depreciation

Loans & EMI

Financial Reports



---

52. FINANCIAL CONTROLS

Trial Balance

Debit = Credit.

Mismatch:

Critical Accounting Exception

Balance Sheet

Assets = Liabilities + Equity

Cash Flow

Operating / Investing / Financing.

GL drilldown:

Account → Transaction → Source Event → Audit


---

53. DRIVER CASH

Opening Cash
+ Collections
+ Advances
− Approved Expenses
− Settlements
− Deposits
=
Expected Cash

Actual cash is compared against expected.

Mismatch → Owner exception.

Priority:

Approved Expenses → Settlements → Advance Recovery

Owner can override with audit trail.


---

54. WHATSAPP / COMMUNICATION

WhatsApp Business API is primary.

Used for:

Orders

Receipts

Delivery confirmation

Payment reminders

Overdue reminders

Payment links

Dispute updates


SMS fallback.

Push notifications:

Owner

Driver


WhatsApp failure never blocks accounting.


---

55. AI

AI Orders

Pricing and order economics.

AI Procurement

Demand, source, timing and purchase planning.

AI Logistics

Vehicle, route, load consolidation and cross-dock.

AI Collections

Payment priority and finance exposure.

AI Backhaul

Return-load opportunities.

AI Profitability

Customer, route, vehicle, product and trip economics.

AI Exceptions

Anomalies and leakage.

AI Decision Log

Every significant AI recommendation and Owner decision can be recorded.

AI recommends. Owner decides.


---

56. EXCEPTION ENGINE

Flags:

Low-margin order

Below-price-floor sale

Credit excess

Overdue customer

Farmer overdue

Cash mismatch

KG mismatch

Inventory shortage

Shrinkage

Rejection

Missing POD

Route delay

Vehicle issue

Quality dispute

Excess finance cost

High service effort

Low-value/high-time customer

Excess workload

Duplicate KG

Impossible KG

Excess incentive

Missing work record

Attendance anomaly

Unusual damage

Suspicious KPI

Accounting imbalance



---

57. APPROVAL ENGINE

Owner approval for:

Price override

Credit exception

Expense

Settlement

Adjustment

Quality decision

Workforce responsibility

Incentive override

Inventory adjustment

Financial exception

Commercial override


Every override:

User

Reason

Date/time

Evidence where applicable

Audit record



---

58. DRIVER SECURITY

Before Publish:

No trip information.

After Publish:

Only required trip information.

Driver cannot access:

Entire customer database

Entire farmer database

Other drivers

Other routes

Customer profitability

Credit

Farmer finances

Business finances


Security:

PIN

Device binding

Trip-scoped authorization

Encrypted local data

Expiring access

No bulk export

No DB download

No other-driver access

Remote purge after sync/handover



---

59. OFFLINE-FIRST

DRIVER EVENT
↓
ENCRYPTED LOCAL QUEUE
↓
SYNC
↓
SERVER VALIDATION
↓
IDEMPOTENT PROCESSING
↓
INVENTORY / MONEY / WORKFORCE / TRIP
↓
ACCOUNTING

Every event has a unique client event ID.

Inventory and financial events cannot use ordinary last-write-wins conflict handling.


---

60. RECONCILIATION

A trip cannot become fully reconciled until:

Procurement

Inventory

Delivery

Collection

Expenses

Workforce

Workload

Cash

Vehicle/KM

Backhaul

Exceptions

Accounting


are checked.

Every area must be:

PASS

or

EXCEPTION

or

APPROVED EXCEPTION

Nothing silently closes.


---

61. COMPLETE DATABASE BASELINE

Parties

Business, User, Role, Driver, Workforce, Casual Worker, Farmer, Customer, Agent.

Product/Market

Product, Market Price Record.

Logistics

Route, Trip, Vehicle, Crew Assignment, Procurement Stop, Delivery, Backhaul.

Procurement/Inventory

Procurement, Pickup Event, Inventory Lot, Inventory Movement.

Sales

Customer Order, Order Reservation, Delivery Line, Invoice.

Finance

Receivable, Collection, Payable, Payment, Payment Allocation, Receipt, Payment Terms, Dispute, Quality Dispute, Credit Adjustment, Expense, Settlement, Driver Cash, Finance Cost.

Workforce

Work Event, Incentive, KPI, Assignment, Earnings, Settlement.

Customer Economics

Customer Score, Payment Score, Score History, Service Effort, Workload Profile, Service Metric, Cost Allocation, Pricing Recommendation.

Vehicle

Fuel, Toll, Maintenance, Vehicle Documents, Fixed Asset, Depreciation, Loan.

Accounting

Chart of Account, Journal Entry, Journal Line, Accounting Period, General Ledger, Trial Balance, Financial Report.

AI/Control

AI Recommendation, AI Decision Log, Exception, Audit Event, WhatsApp Message, Notification.


---

62. DATABASE DEVELOPMENT REQUIREMENT

Before production:

ERD

Must finalize:

PK

FK

One-to-one

One-to-many

Many-to-many/junction

Historical/version relationships

Event relationships

Accounting relationships

Audit relationships


Indexing

Must cover high-frequency queries involving:

Business

Customer

Farmer

Product

Route

Trip

Vehicle

Driver

Procurement

Inventory

Delivery

Payment

Receivable

Payable

Workforce

Incentive

Accounting

Exception

Audit

Date

Status

Attribution


ERD and indexing are developer deliverables, not Owner/Driver screens.


---

63. FINAL CONTROL MODEL

OWNER APP
     ↓
CONTROL
     ↓
BACKEND
     ↓
CALCULATE
     ↓
DRIVER APP
     ↓
EXECUTE
     ↓
PHYSICAL EVENTS
     ↓
INVENTORY + MONEY + WORKFORCE + TRIP
     ↓
ACCOUNTING + COSTING
     ↓
AI + EXCEPTIONS
     ↓
OWNER DECISION


---

64. FINAL ECONOMIC MODEL

Customer

ORDER
↓
DELIVERY
↓
VERIFIED SERVICE EFFORT
↓
WORKLOAD
↓
ATTRIBUTABLE COST
↓
TRUE COST
↓
CONTRIBUTION
↓
FINANCE COST
↓
NET CONTRIBUTION
↓
AI PRICE
↓
OWNER DECISION

Driver

TRIP
↓
BASE
↓
KPI
↓
NEW CUSTOMERS
↓
CUSTOMER TURNOVER
↓
CUSTOMER KG
↓
PRODUCTIVITY
↓
CONSISTENCY / RETENTION
↓
OTHER APPROVED INCENTIVES
↓
UNCAPPED VERIFIED GROWTH EARNING


---

65. FINAL NON-NEGOTIABLE PRINCIPLES

> One business. Two apps. One database. One source of truth.



> Simple SOP. Simple Driver App. Powerful Owner App. Powerful Backend.



> Owner decides. Driver executes. ERP calculates.



> Every KG traceable.



> Every rupee traceable.



> Every asset and loan traceable.



> Every important decision auditable.



> Operations record reality. Accounting records financial impact.



> No workforce monetary incentive is hard-coded. Owner configures the money.



> Base compensation is separate from performance and growth incentives.



> Driver growth incentives are uncapped and based on verified business growth.



> New-customer, turnover and KG incentives remain separate measurements.



> Duplicate or artificial activity does not qualify.



> Customer workload uses verified rolling data.



> Customer value never determines service quality.



> Customer complaints do not automatically penalize workers.



> Responsibility requires evidence.



> Bulk operations use lot/event accountability; individual penalties require observable responsibility.



> Base driver trip compensation is not automatically allocated to customers.



> Customer-specific verified workload incentives may be allocated to customer economics.



> Large line-haul + efficient last-mile + consolidation/cross-dock is the scaling model.



> Low margin + low operating cost + high utilization + high inventory velocity + high route density is the operating model.



> AI recommends. Owner decides.



> Nothing silently reconciles.



> Every reconciliation is PASS, EXCEPTION or APPROVED EXCEPTION.



> ERD and indexing are finalized before production database development.



Final architecture

DEMAND → ORDER → PRICE → CREDIT → PROCUREMENT → FARMER → LOT → AGGREGATION → LOAD → LINE-HAUL → CROSS-DOCK → LAST-MILE → DELIVERY → POD → COLLECTION → DISPUTE → INVENTORY → SHRINKAGE → FINANCE → WORKFORCE → VEHICLE → RECONCILIATION → ACCOUNTING → TRUE COST → PROFIT → AI → OWNER DECISION.

This is the single combined master specification, with the complete business process retained while eliminating duplicate presentation.
