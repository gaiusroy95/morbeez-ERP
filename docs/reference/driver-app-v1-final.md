<!-- Driver App — V1 Final — as the client sent it, 9 Nov 2026. Kept verbatim; the plan is docs/redesign/master-spec-v3-plan.md. -->

# MORBEEZ DRIVER APP — V1 FINAL

**V1 = exact operational loop**
**V1.18 = incentive engine**
**Field hardening = offline, safe confirmation, edit-before-complete, ETA, rejection reasons**

## 1. Navigation

**Bottom navigation — only 3**

```text
┌─────────────────────────────────┐
│  🏠 Dashboard │ 🧺 Procurement │ 🚚 Delivery │
└─────────────────────────────────┘
```

**Side drawer**

```text
OPERATIONS
• Expense
• Collections
• Backhaul

MY
• My Earnings
• Incentives
• Settlements

TRIPS
• Current Trip
• Completed Trips
• Trip History

CONTROL
• Approvals
• Vehicle
• Sync

ACCOUNT
• Profile
• Language
• Help
```

---

# 2. START DAY

Driver reaches vehicle.

```text
MORBEEZ DRIVER APP

Vehicle
[ KA-01-1234 ▼ ]

Driver
Raju

Opening KM
[ 48,620 ]

GPS ✓
ONLINE ✓

[ START DAY ]
```

Backend creates the trip and records driver, vehicle, opening KM, GPS and time.

---

# 3. DASHBOARD

The driver's dashboard is **NEXT ACTION first**.

```text
● ONLINE       Trip T-1909-004

Raju · KA-01-1234

START → PICK → LOAD → DELIVER

┌──────────────────────────────┐
│ NEXT ACTION                  │
│                              │
│ ABC FARM                     │
│ Ginger · Carrot · Onion      │
│ 📍 3.2 KM · 8 MIN            │
│                              │
│ [ CALL ]   [ NAVIGATE ]      │
└──────────────────────────────┘

PROCUREMENT       3 / 3
DELIVERY          0 / 5

EARNED SO FAR     ₹1,850

VEHICLE STOCK     1,895 KG
```

Header always shows:

**ONLINE / OFFLINE / SYNCING + Trip ID**

---

# 4. PROCUREMENT

Procurement is **farmer-stop based**.

```text
TODAY'S PROCUREMENT

① ABC FARM
3 Products
Ginger 500 KG
Carrot 300 KG
Onion 200 KG

[ CALL ] [ NAVIGATE ]

② RAMESH FARM
2 Products
Ginger 400 KG
Tomato 250 KG

[ CALL ] [ NAVIGATE ]

③ GREEN FARM
4 Products
...
```

**One farmer = one stop.**

A farmer can provide any number of products.

---

# 5. FARMER STOP

```text
ABC FARM
📍 3.2 KM · 8 MIN

[ CALL FARMER ]
[ CALL PACKER ]
[ CALL LOADER ]

PRODUCTS

Ginger       500 KG
[ ACCEPT ] [ REJECT ]

Carrot       300 KG
[ ACCEPT ] [ REJECT ]

Onion        200 KG
[ ACCEPT ] [ REJECT ]

[ START PICKUP ]
```

### Reject

If rejected:

```text
REJECT GINGER

○ Quality
○ Quantity short
○ Damaged
○ Farmer not ready
○ Other

[ ADD PHOTO ]

[ CONFIRM REJECT ]
```

---

# 6. PACKER / LOADER / SACK

```text
PACKING CREW

Packer
[ Suresh ▼ ]

Loader
[ Ramesh ▼ ]

☐ Same person

SACKS

Ginger     [10]
Carrot     [7]
Onion      [5]

[ CONTINUE ]
```

Same person doing both = **one workforce cost**.

---

# 7. WEIGH + LOAD

```text
GINGER
Planned 500 KG
Actual [480] KG
Unit [KG ▼]

CARROT
Planned 300 KG
Actual [315] KG
Unit [KG ▼]

ONION
Planned 200 KG
Actual [190] KG
Unit [KG ▼]

[ TAKE PHOTO ]

[ LOAD VEHICLE ]
```

Quantity supports **KG/BAG**.

Product quantity and crates remain separate concepts.

---

# 8. COMPLETE FARMER

```text
ABC FARM

✓ Ginger      480 KG
✓ Carrot      315 KG
✓ Onion       190 KG

TOTAL         985 KG

✓ Weighed
✓ Loaded
✓ Photo

[ HOLD 2 SEC → COMPLETE FARMER ]

[ EDIT ANY LINE ]
```

A farmer cannot be completed until every product line is:

* accepted + weighed + loaded, or
* rejected, or
* approved exception.

Then:

**ABC FARM → COMPLETED ✓**

The driver moves to the next farmer. The stop-based model is the core V1 operation. 

---

# 9. ALL PROCUREMENT COMPLETE

```text
✓ PROCUREMENT COMPLETE

Farmers        3 / 3
Product Lines  9 / 9

VEHICLE STOCK

Ginger        880 KG
Carrot        515 KG
Onion         490 KG
Tomato        400 KG
Potato        250 KG

TOTAL       2,535 KG

[ GO TO DELIVERY ]
```

---

# 10. DELIVERY

```text
DELIVERY

        [ START TRIP ]

① ABC TRADERS
Ginger 400 KG
Carrot 200 KG

② XYZ FOODS
Onion 300 KG
Tomato 150 KG

③ FRESH MART
Ginger 480 KG
Potato 250 KG

④ GREEN STORES
...
```

Customer is a **delivery stop**, and one customer can receive multiple products. 

---

# 11. SEQUENTIAL ROUTE

After **START TRIP**:

```text
NEXT STOP

ABC TRADERS

📍 4.8 KM · 11 MIN

Ginger       400 KG
Carrot       200 KG

          MAP

[ START NAVIGATION ]
```

Backend determines the sequential route.

---

# 12. CUSTOMER QR

At the shop:

```text
SCAN CUSTOMER QR

       ┌─────────┐
       │   QR    │
       └─────────┘

✓ CUSTOMER VERIFIED
✓ DESTINATION VERIFIED

[ CONTINUE ]
```

Wrong QR → delivery blocked.

---

# 13. DELIVERY

```text
ABC TRADERS ✓

Ginger
Ordered      400 KG
Delivered    [400 KG]

Carrot
Ordered      200 KG
Delivered    [200 KG]

All goods unloaded?
[ YES ]

Delivery Photo
[ TAKE PHOTO ]

CRATES
Sent:       20
Returned:  [20]

[ HOLD 2 SEC → COMPLETE DELIVERY ]
```

Next stop remains locked until:

**QR ✓ → Quantity ✓ → Unloaded ✓ → Photo ✓ → Crates ✓**

---

# 14. CRATES

Crates are **assets**, not product quantity.

```text
Sent       20
Returned   20
```

→ Complete.

If:

```text
Sent       20
Returned   18
```

→ Record shortage + reason.

No automatic driver deduction.

---

# 15. VEHICLE STOCK

At any time:

```text
VEHICLE STOCK

Ginger       620 KG
Carrot       200 KG
Onion        190 KG
Tomato       150 KG
Potato       250 KG

TOTAL       1,410 KG
```

After all deliveries:

## **VEHICLE STOCK = 0 KG**

If not zero, reconciliation is mandatory before continuing. 

---

# 16. BACKHAUL

After the final delivery:

```text
BACKHAUL AVAILABLE

Pickup
Mysuru Market

Drop
Gundlpet Base

FIXED RENT
₹3,500

No Product
No KG
No Vegetable
No Inventory

[ ACCEPT BACKHAUL ]
[ SKIP ]
```

Backhaul is **only a fixed-rent transport job**. 

---

# 17. BACKHAUL DELIVERY + PAYMENT

```text
BACKHAUL

✓ Pickup reached
✓ Load complete

[ NAVIGATE TO DROP ]

✓ Drop reached

[ DELIVERY PHOTO ]

[ COMPLETE BACKHAUL ]
```

Then:

```text
BACKHAUL PAYMENT

Fixed Rent
₹3,500

○ Cash
○ UPI
○ Account Transfer

[ RECEIVE PAYMENT ]
```

Backhaul must be completed and payment recorded before final trip closure.

---

# 18. COLLECTIONS — FINAL LOGIC

### This is the important correction.

**Collections show ONLY customers actually delivered during the current trip.**

Not all customers in the company.

Not all overdue customers.

Not customers who were not delivered.

```text
COLLECTIONS — THIS TRIP

Delivered Customers     4
Pending Collection      4
Balance             ₹1,52,000

ABC TRADERS
Delivered ✓
Outstanding ₹48,500

[ CALL ] [ COLLECT ]

XYZ FOODS
Delivered ✓
Outstanding ₹72,000

[ CALL ] [ COLLECT ]

FRESH MART
Delivered ✓
Outstanding ₹31,500

[ CALL ] [ COLLECT ]

GREEN STORES
Delivered ✓
Outstanding ₹0
✓ Already Paid
```

### Logic

```text
CURRENT TRIP
     ↓
CUSTOMER DELIVERED?
     ↓ YES
ELIGIBLE FOR COLLECTION
     ↓
SHOW CURRENT OUTSTANDING BALANCE
     ↓
COLLECT / SKIP
```

A customer with an old outstanding balance but **not delivered on this trip does not appear**.

---

# 19. COLLECTION PAYMENT

```text
ABC TRADERS

Outstanding
₹48,500

Amount Received
[ ₹48,500 ]

PAYMENT METHOD

○ CASH
○ UPI
○ ACCOUNT TRANSFER

Payment Reference
[___________]

Payment Proof
[ TAKE PHOTO ]

[ CONFIRM COLLECTION ]
```

### Cash

Adds to **Driver Cash**.

### UPI

Does **not** add to physical Driver Cash.

### Account Transfer

Does **not** add to physical Driver Cash.

---

# 20. PARTIAL COLLECTION

```text
Outstanding
₹48,500

Collected
₹30,000

Remaining
₹18,500

Payment
CASH

[ CONFIRM ]
```

Customer remains on the collection list with:

**Balance ₹18,500**

---

# 21. THIRD-PARTY PAYMENT

If somebody else pays:

```text
Customer
ABC Traders

Paid By
Rajesh

Type
Customer Staff

Amount
₹48,500

Payment
UPI

[ CONFIRM ]
```

Customer ledger receives the payment.

If amount is disputed, driver requests Owner approval; driver cannot write off the balance.

---

# 22. RETURN + CLOSING KM

After backhaul and collection:

```text
RETURN TO BASE

Opening KM
48,620

Closing KM
[48,812]

Trip KM
192 KM

[ CONFIRM KM ]
```

Backhaul is completed **before final KM calculation**.

---

# 23. CASH HANDOVER

```text
CASH HANDOVER

Cash Collections       ₹48,500
Cash Backhaul            ₹3,500
Cash Expenses            ₹6,200
Other Cash                   ₹0
──────────────────────────────
EXPECTED CASH           ₹45,800

Actual Cash
[ ₹45,800 ]

[ HOLD → HANDOVER TO OWNER ]
```

UPI/account-transfer collections are **not included in physical cash**.

Mismatch → Owner exception.

No automatic salary deduction.

---

# 24. V1.18 INCENTIVES — AUTOMATIC

The driver does not manually enter incentives.

| Incentive       | Derived from                    |
| --------------- | ------------------------------- |
| Collection      | Actual customer collection      |
| Backhaul        | Completed fixed-rent backhaul   |
| Mileage         | KM + vehicle/fuel data          |
| Crate           | Crates sent/returned            |
| Quality         | Acceptance/rejection/shrinkage  |
| New Customer    | Qualifying new customer/order   |
| Performance     | Owner KPI                       |
| Night Duty      | Qualifying trip                 |
| Data Quality    | Complete valid operational data |
| Trip Completion | Successful trip completion      |

---

# 25. MY EARNINGS

```text
TODAY'S EARNINGS

Fixed Pay              ₹1,200

Collection Incentive     ₹300
Backhaul Incentive       ₹350
Mileage Incentive        ₹500
Crate Incentive          ₹200
Quality Incentive        ₹150
New Customer             ₹200
Performance              ₹300
Night Duty                 ₹0
Data Quality             ₹100
Trip Completion          ₹250
────────────────────────────
TOTAL                  ₹3,550

[ RECEIVE PAYMENT ]
```

The driver performs the work; the backend calculates the earnings.

---

# 26. TRIP SUMMARY

```text
TRIP SUMMARY

✓ Procurement             3 / 3
✓ Delivery                5 / 5
✓ Vehicle Stock             0 KG
✓ Crates                  50 / 50
✓ Backhaul             Completed
✓ Backhaul Payment      Received
✓ Collections          Recorded
✓ Expenses             Recorded
✓ Closing KM             48,812
✓ Trip KM                    192

Driver Earnings          ₹3,550

[ CLOSE TRIP ]
```

---

# 27. FINAL CLOSE CHECK

```text
✓ Every farmer stop complete
✓ Every procurement product resolved
✓ All accepted goods weighed
✓ All accepted goods loaded

✓ Every delivery complete
✓ Customer QR verified
✓ Delivery photos complete
✓ Vehicle stock = 0 KG
✓ Crates reconciled

✓ Backhaul complete / valid skip
✓ Backhaul payment recorded

✓ Only delivered-trip customers used for collections
✓ Collections recorded
✓ Expenses recorded
✓ Closing KM recorded
✓ Cash handed over

✓ Workforce events generated
✓ Incentives calculated
✓ Driver settlement ready

[ HOLD 3 SEC → CLOSE TRIP ]
```

---

# FINAL V1 ARCHITECTURE

```text
START DAY
    ↓
PROCUREMENT
    ↓
FARMER STOP
    ├── Multiple Products
    ├── Accept / Reject
    ├── Packer / Loader
    ├── Sack
    ├── Weigh
    └── Load
    ↓
COMPLETE FARMER
    ↓
NEXT FARMER
    ↓
ALL FARMERS COMPLETE
    ↓
DELIVERY → START TRIP
    ↓
SEQUENTIAL ROUTE
    ↓
CUSTOMER QR
    ↓
MULTIPLE PRODUCTS
    ↓
UNLOAD + PHOTO + CRATES
    ↓
NEXT CUSTOMER
    ↓
STOCK = 0
    ↓
BACKHAUL
    ├── Fixed Rent
    ├── Load
    ├── Deliver
    └── Payment
    ↓
COLLECTIONS
    └── ONLY CURRENT-TRIP DELIVERED CUSTOMERS
    ↓
RETURN TO BASE
    ↓
CLOSING KM
    ↓
CASH HANDOVER
    ↓
V1.18 INCENTIVE ENGINE
    ↓
DRIVER SETTLEMENT
    ↓
CLOSE TRIP
```

### Final principle

**V1 = the driver's exact physical operation.**
**V1.18 = automatic incentive/earning engine.**
**Field hardening = offline + ETA + rejection reasons + edit-before-complete + safe confirmation + live earnings.**

The driver's experience remains:

> **START → PICK → LOAD → DELIVER → EMPTY VEHICLE → BACKHAUL → COLLECT → RETURN → HANDOVER → GET PAID → CLOSE**

And the collection rule is now firmly:

> **ONLY CUSTOMERS DELIVERED ON THE CURRENT TRIP APPEAR IN COLLECTIONS.**
