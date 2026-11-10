<!-- Owner & Driver Daily Operations — as the client sent it, 9 Nov 2026. Kept verbatim; the plan is docs/redesign/master-spec-v3-plan.md. -->

Morbeez — Owner & Driver Daily Operations

Owner — Daily Operations

The Owner operates the business as the control tower. The Owner does not manually enter every field activity; the Owner plans, approves, monitors and reconciles.

Start of day

Review previous-day reconciliation, cash, collections, inventory and exceptions.

Review today's customer orders and outstanding deliveries.

Review available inventory and procurement requirements.

Review market/purchase/selling prices.

Confirm farmer procurement and required quantities.

Review customer credit and overdue payments.

Build today's routes and trips.

Match procurement, customer orders, inventory, vehicle capacity, driver and delivery windows.

Review AI recommendations for pricing, procurement, load consolidation and route economics.

Confirm and publish trips.


During operations

Monitor active trips.

Track procurement pickups and actual KG.

Monitor vehicle inventory.

Monitor customer deliveries, POD and collections.

Handle shortages, quality issues, rejections and customer disputes.

Approve commercial price/credit overrides.

Approve expenses, settlements and exceptional adjustments.

Monitor cash and collection exposure.

Monitor vehicle/route delays and utilization.

Monitor workforce issues and exceptions.

Make decisions when actual field conditions differ from the plan.


End of day

Review completed procurement.

Reconcile purchased KG vs received KG vs saleable KG.

Reconcile deliveries and remaining inventory.

Reconcile customer collections.

Reconcile driver cash.

Review expenses.

Review workforce earnings.

Review vehicle KM/fuel/trip costs.

Review backhaul.

Review disputes and exceptions.

Reconcile accounting.

Mark each area PASS / EXCEPTION / APPROVED EXCEPTION.

Close/handover the trip.

Review business contribution, cash position, working capital and major profit leakage.


Owner's daily principle

> Plan the business → publish the work → monitor reality → approve decisions → reconcile everything → understand the economics.




---

Driver — Daily Operations

The Driver is the field execution owner. The Driver should not make unnecessary commercial decisions or navigate through complicated ERP screens.

Start of day

Open the published trip.

See assigned vehicle, route, procurement and deliveries.

Check vehicle condition.

Enter/confirm opening KM.

Confirm fuel/vehicle issue if required.

Confirm crew.

Start the trip.


Procurement

For each assigned farmer:

NEXT PICKUP → NAVIGATE → ARRIVE → VERIFY → WEIGH → PHOTO → ACCEPT/REJECT → LOAD → COMPLETE

Driver records:

Actual KG

Quality/acceptance

Photo/evidence

Any shortage or issue


The ERP already knows:

Farmer

Product

Planned quantity

Purchase terms

Driver

Vehicle

Trip

Route


Driver does not re-enter those details.

During transport

Vehicle inventory is automatically updated from completed pickup events.

Driver follows the assigned route.

Driver records genuine delays/issues.

Driver may execute assigned cross-dock/transfer operations.

Driver records backhaul when applicable.

Driver records approved trip expenses.


Customer delivery

For each customer:

NEXT DELIVERY → NAVIGATE → ARRIVE → DELIVER → POD → COLLECTION → COMPLETE

Driver records:

Actual delivered KG

Short/partial delivery if applicable

POD/photo

Collection amount

Payment method

Customer issue/dispute evidence


The system already knows:

Customer

Product

Order

Quantity

Price

Route

Trip

Credit/collection requirement


If something goes wrong

Driver records the physical reality:

Shortage

Rejection

Damage

Quality complaint

Customer unavailable

Route delay

Vehicle problem

Cash issue

Weight mismatch


The Driver does not decide the commercial resolution.

The event goes to the Owner.


---

Driver — End of Day

Driver:

Completes remaining deliveries/pickups.

Records final expenses.

Records backhaul.

Confirms remaining vehicle inventory.

Enters closing KM.

Counts actual cash.

Reports vehicle issues.

Submits trip.


Then:

DRIVER SUBMITS
      ↓
ERP RECONCILES
      ↓
OWNER REVIEWS
      ↓
PASS / EXCEPTION / APPROVED EXCEPTION
      ↓
TRIP CLOSED


---

The Daily Division of Responsibility

Activity	Owner	Driver

Customer order	Decides	—
Selling price	Approves	—
Credit	Approves	—
Procurement planning	Decides	—
Farmer pickup	—	Executes
Actual KG	Reviews	Records
Quality evidence	Reviews	Records
Vehicle movement	Monitors	Executes
Route execution	Plans	Executes
Customer delivery	Monitors	Executes
POD	Reviews	Records
Collection	Controls	Collects/records
Expense	Approves	Records
Customer dispute	Decides resolution	Provides evidence
Workforce responsibility	Approves	Provides event evidence
Cash reconciliation	Controls	Reports actual cash
Trip reconciliation	Owns	Submits field data
Profitability	Owns	—
AI recommendations	Reviews	—


Simple operating rule

> OWNER = PLAN + DECIDE + APPROVE + MONITOR + RECONCILE



> DRIVER = PICKUP + LOAD + TRANSPORT + DELIVER + COLLECT + RECORD



> ERP = CALCULATE + TRACE + RECONCILE + ALERT



This is the intended real daily operating model behind the two-app architecture.
