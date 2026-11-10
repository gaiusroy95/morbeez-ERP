<!-- The client's summary of the regrouped spec and its 12 fixes — as the client sent it, 9 Nov 2026. Kept verbatim; the plan is docs/redesign/master-spec-v3-plan.md. -->

I kept every rule from your original and regrouped the 65 sections into 15 parts. On top of that, I added 12 fixes:

**Accounting correctness**
1. **COGS entry at delivery.** Inventory now leaves the books when stock is sold, so the P&L is correct.
2. **Journals for shrinkage, credit notes, bad debt, finance charges, farmer advances, agent commission and vehicle disposal.**
3. **Specific-lot costing.** Each delivery uses the actual cost of the lot it came from.
4. **Period close and lock.** A 5-step month-end checklist; locked months take no edits.
5. **Tax layer.** GST (including exempt vegetables), HSN, TDS on farmer/agent payments, e-invoice readiness.

**Business logic fixes**
6. **Finance cost split in two.** The internal cost of capital runs from day 0. The customer charge applies only after the due date, and only if you switch it on.
7. **Standard Cost for the price floor.** The floor is based on rolling 30-day actual shrink, rejection and ops cost. After the trip, actual cost is compared to it.
8. **Cost allocation rules.** How fuel, vehicle and labour costs spread to each order, so every rupee is counted once.

**Operational gaps**
9. **Spot-sale flow.** Drivers can sell to walk-in buyers or offload rejects. Sales inside a pre-set price band go through automatically; anything outside needs Owner approval.
10. **Crate ledger.** Crate balances per customer, farmer and vehicle, with overdue alerts and loss charges.
11. **Delegation matrix.** Roles such as Ops Manager and Accountant can approve up to set ₹ limits, so the Owner isn't a bottleneck.
12. **Trip state machine and master-data versioning.** Trip stages are explicit, and rate or terms changes are dated versions, not overwrites.

**Smaller additions**
- Minimum-wage floor on workforce pay.
- Incentives paid on collected turnover, not just billed.
- Vehicle document expiry alerts and hired-vehicle costing.
- UPI collections kept out of driver cash.
- A suggested build order for developers.

I also left one question in the doc: how trip costs should be split between KG delivered and customer service time.
