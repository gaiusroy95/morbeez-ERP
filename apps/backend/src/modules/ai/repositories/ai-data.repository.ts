import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

type Row = Record<string, unknown>;

/**
 * Everything the AI reads, and nothing it writes: every method runs on a
 * client from DatabaseService.withTenantReadOnly — a READ ONLY transaction
 * as the SELECT-only morbeez_ai role, with RLS scoping it to one tenant
 * (AI System DR.1, AISEC.1). Child tables without a tenant column (order
 * lines, trip stops and expenses, reconciliations) are always reached
 * through their RLS-scoped parent.
 *
 * Dates are the tenant's local calendar days.
 */
@Injectable()
export class AiDataRepository {
  async books(client: PoolClient): Promise<{ today: string; timezone: string; currency: string }> {
    const r = await client.query(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today, timezone, currency FROM tenant.tenant WHERE id = current_tenant_id()`,
    );
    return r.rows[0];
  }

  async products(client: PoolClient): Promise<{ id: string; name: string; uom: string; base_price: string; version: number }[]> {
    const r = await client.query(`SELECT id, name, base_uom AS uom, base_price::text AS base_price, version FROM trading_partners.product WHERE status = 'active' ORDER BY name`);
    return r.rows;
  }

  /** Quantity sold per product per day: invoiced sales plus completed spot sales. */
  async dailySales(client: PoolClient, tz: string, from: string, to: string): Promise<{ product_id: string; day: string; qty: string }[]> {
    const r = await client.query(
      `SELECT product_id, day, SUM(qty)::text AS qty FROM (
         SELECT l.product_id, (i.issued_at AT TIME ZONE $1)::date::text AS day, l.quantity AS qty
         FROM money.invoice i JOIN money.invoice_line l ON l.invoice_id = i.id
         WHERE i.kind = 'sale' AND l.product_id IS NOT NULL AND (i.issued_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT l.product_id, (s.sold_at AT TIME ZONE $1)::date::text, l.quantity
         FROM spot.spot_sale s JOIN spot.spot_sale_line l ON l.sale_id = s.id
         WHERE s.status = 'completed' AND (s.sold_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ) x GROUP BY product_id, day`,
      [tz, from, to],
    );
    return r.rows;
  }

  async firstSales(client: PoolClient, tz: string): Promise<Map<string, string>> {
    const r = await client.query(
      `SELECT product_id, MIN(day)::text AS first FROM (
         SELECT l.product_id, (i.issued_at AT TIME ZONE $1)::date AS day FROM money.invoice i JOIN money.invoice_line l ON l.invoice_id = i.id WHERE i.kind = 'sale' AND l.product_id IS NOT NULL
         UNION ALL
         SELECT l.product_id, (s.sold_at AT TIME ZONE $1)::date FROM spot.spot_sale s JOIN spot.spot_sale_line l ON l.sale_id = s.id WHERE s.status = 'completed'
       ) x GROUP BY product_id`,
      [tz],
    );
    return new Map(r.rows.map((x) => [x.product_id as string, x.first as string]));
  }

  /** Free stock (available, not reserved) and its weighted unit cost. */
  async freeStock(client: PoolClient): Promise<Map<string, { qty: string; unitCost: string | null }>> {
    const r = await client.query(
      `SELECT product_id, SUM(current_quantity)::text AS qty,
              CASE WHEN SUM(current_quantity) > 0 THEN ROUND(SUM(current_quantity * unit_cost) / SUM(current_quantity), 2)::text END AS unit_cost
       FROM commerce.lot WHERE status = 'available' AND current_quantity > 0 AND unit_cost IS NOT NULL
       GROUP BY product_id`,
    );
    return new Map(r.rows.map((x) => [x.product_id as string, { qty: x.qty as string, unitCost: x.unit_cost as string | null }]));
  }

  /** Confirmed or placed purchase orders not yet received, by product. */
  async inbound(client: PoolClient): Promise<Map<string, string>> {
    const r = await client.query(
      `SELECT l.product_id, GREATEST(SUM(l.expected_quantity) - COALESCE(SUM(rcv.qty), 0), 0)::text AS qty
       FROM commerce.purchase_order po
       JOIN commerce.purchase_order_line l ON l.purchase_order_id = po.id
       LEFT JOIN LATERAL (SELECT SUM(received_quantity) AS qty FROM commerce.lot WHERE purchase_order_id = po.id AND product_id = l.product_id) rcv ON true
       WHERE po.status IN ('placed', 'confirmed')
       GROUP BY l.product_id`,
    );
    return new Map(r.rows.map((x) => [x.product_id as string, x.qty as string]));
  }

  /** Share of what was accepted in the last 8 weeks later lost to shrinkage or rejection. */
  async shrinkRates(client: PoolClient, since: Date): Promise<Map<string, number>> {
    const r = await client.query(
      `SELECT l.product_id, SUM(l.accepted_quantity)::float8 AS accepted,
              COALESCE((SELECT SUM(m.quantity) FROM stock.inventory_movement m
                        WHERE m.product_id = l.product_id AND m.movement_type IN ('shrinkage', 'rejected_post_acceptance') AND m.created_at >= $1), 0)::float8 AS lost
       FROM commerce.lot l WHERE l.graded_at >= $1 AND l.accepted_quantity > 0
       GROUP BY l.product_id`,
      [since],
    );
    return new Map(r.rows.map((x) => [x.product_id as string, (x.lost as number) / (x.accepted as number)]));
  }

  /** The farmers most recently bought from, per product, with their last price. */
  async recentFarmers(client: PoolClient): Promise<Map<string, { farmerId: string; name: string; lastPrice: string; lastOn: string }[]>> {
    const r = await client.query(
      `SELECT * FROM (
         SELECT l.product_id, po.farmer_id, f.name, l.indicative_price::text AS last_price, po.created_at::date::text AS last_on,
                ROW_NUMBER() OVER (PARTITION BY l.product_id, po.farmer_id ORDER BY po.created_at DESC) AS rn_farmer
         FROM commerce.purchase_order po
         JOIN commerce.purchase_order_line l ON l.purchase_order_id = po.id
         JOIN trading_partners.farmer f ON f.id = po.farmer_id AND f.status = 'active'
         WHERE po.status <> 'cancelled'
       ) x WHERE rn_farmer = 1 ORDER BY product_id, last_on DESC`,
    );
    const out = new Map<string, { farmerId: string; name: string; lastPrice: string; lastOn: string }[]>();
    for (const x of r.rows) {
      const list = out.get(x.product_id) ?? [];
      if (list.length < 3) list.push({ farmerId: x.farmer_id, name: x.name, lastPrice: x.last_price, lastOn: x.last_on });
      out.set(x.product_id, list);
    }
    return out;
  }

  /** Prices actually realized in the window, by product. */
  async realizedPrices(client: PoolClient, tz: string, from: string, to: string): Promise<Map<string, { low: string; high: string; average: string; lines: number }>> {
    const r = await client.query(
      `SELECT product_id, MIN(price)::text AS low, MAX(price)::text AS high,
              ROUND(SUM(price * qty) / NULLIF(SUM(qty), 0), 2)::text AS average, count(*)::int AS lines
       FROM (
         SELECT l.product_id, l.unit_price AS price, l.quantity AS qty FROM money.invoice i JOIN money.invoice_line l ON l.invoice_id = i.id
         WHERE i.kind = 'sale' AND l.product_id IS NOT NULL AND (i.issued_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT l.product_id, l.unit_price, l.quantity FROM spot.spot_sale s JOIN spot.spot_sale_line l ON l.sale_id = s.id
         WHERE s.status = 'completed' AND (s.sold_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
       ) x GROUP BY product_id`,
      [tz, from, to],
    );
    return new Map(r.rows.map((x) => [x.product_id as string, { low: x.low, high: x.high, average: x.average, lines: x.lines }]));
  }

  // ---- Logistics ----

  async pins(client: PoolClient): Promise<{ kind: string; ref_id: string | null; latitude: string; longitude: string }[]> {
    const r = await client.query('SELECT kind, ref_id, latitude::text, longitude::text FROM fulfilment.place_pin');
    return r.rows;
  }

  /** Planned trips' delivery and pickup stops, in their current order, with the place each goes to. */
  async plannedTrips(client: PoolClient): Promise<Row[]> {
    const r = await client.query(
      `SELECT t.id AS trip_id, t.vehicle_id, v.registration_number, t.version, s.id AS stop_id, s.sequence_number, s.stop_type,
              CASE s.stop_type WHEN 'delivery' THEN 'customer' ELSE 'farmer' END AS place_kind,
              COALESCE(o.customer_id, p.farmer_id) AS place_id, COALESCE(c.name, f.name) AS place_name
       FROM fulfilment.trip t
       JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
       JOIN fulfilment.trip_stop s ON s.trip_id = t.id
       LEFT JOIN commerce.customer_order o ON o.id = s.order_id
       LEFT JOIN trading_partners.customer c ON c.id = o.customer_id
       LEFT JOIN commerce.pickup p ON p.id = s.pickup_id
       LEFT JOIN trading_partners.farmer f ON f.id = p.farmer_id
       WHERE t.status = 'planned' AND s.status = 'pending'
       ORDER BY t.id, s.sequence_number`,
    );
    return r.rows;
  }

  /** Confirmed orders not yet on any trip, with their weight where the unit is a weight. */
  async unassignedOrders(client: PoolClient): Promise<{ order_id: string; customer_id: string; customer_name: string; kg: string; unweighed_lines: number }[]> {
    const r = await client.query(
      `SELECT o.id AS order_id, o.customer_id, c.name AS customer_name,
              COALESCE(SUM(CASE p.base_uom WHEN 'kg' THEN l.quantity WHEN 'g' THEN l.quantity / 1000 END), 0)::text AS kg,
              count(*) FILTER (WHERE p.base_uom NOT IN ('kg', 'g'))::int AS unweighed_lines
       FROM commerce.customer_order o
       JOIN trading_partners.customer c ON c.id = o.customer_id
       JOIN commerce.customer_order_line l ON l.order_id = o.id
       JOIN trading_partners.product p ON p.id = l.product_id
       WHERE o.status = 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
                         WHERE s.order_id = o.id AND t.status <> 'cancelled' AND s.status <> 'skipped')
       GROUP BY o.id, o.customer_id, c.name
       ORDER BY o.created_at`,
    );
    return r.rows;
  }

  /**
   * Vehicles free to take a load: active, fit (no current document past
   * its date), not already on a planned or running trip; with a cost per
   * km from the last 90 days of fuel against odometer readings.
   */
  async freeVehicles(client: PoolClient, today: string): Promise<{ vehicle_id: string; registration_number: string; capacity_kg: string; cost_per_km: string | null }[]> {
    const r = await client.query(
      `SELECT v.id AS vehicle_id, v.registration_number, v.capacity_kg::text, fuel.cost_per_km
       FROM trading_partners.vehicle v
       -- Fuel bought after the first reading, over the km driven since it (the first fill was burnt before).
       LEFT JOIN LATERAL (
         SELECT CASE WHEN MAX(f.odometer_km) - MIN(f.odometer_km) > 0
                  THEN ROUND((SUM(f.amount) - (ARRAY_AGG(f.amount ORDER BY f.odometer_km))[1]) / (MAX(f.odometer_km) - MIN(f.odometer_km)), 2)::text END AS cost_per_km
         FROM fleet.fuel_log f WHERE f.vehicle_id = v.id AND f.filled_on >= $1::date - 90 AND f.odometer_km IS NOT NULL
       ) fuel ON true
       WHERE v.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM fulfilment.trip t WHERE t.vehicle_id = v.id AND t.status IN ('planned', 'in_progress'))
         AND NOT EXISTS (
           SELECT 1 FROM (SELECT DISTINCT ON (d.doc_type) d.valid_until FROM fleet.vehicle_document d
                          WHERE d.vehicle_id = v.id AND d.doc_type <> 'other' ORDER BY d.doc_type, d.created_at DESC) cur
           WHERE cur.valid_until IS NOT NULL AND cur.valid_until < $1::date)
       ORDER BY v.registration_number`,
      [today],
    );
    return r.rows;
  }

  async vehicleCostPerKm(client: PoolClient, vehicleIds: string[], today: string): Promise<Map<string, string>> {
    const r = await client.query(
      `SELECT vehicle_id, ROUND((SUM(amount) - (ARRAY_AGG(amount ORDER BY odometer_km))[1]) / (MAX(odometer_km) - MIN(odometer_km)), 2)::text AS c
       FROM fleet.fuel_log WHERE vehicle_id = ANY($1::uuid[]) AND filled_on >= $2::date - 90 AND odometer_km IS NOT NULL
       GROUP BY vehicle_id HAVING MAX(odometer_km) - MIN(odometer_km) > 0`,
      [vehicleIds, today],
    );
    return new Map(r.rows.map((x) => [x.vehicle_id as string, x.c as string]));
  }

  // ---- Customer profitability ----

  async customerFigures(client: PoolClient, tz: string, from: string, to: string): Promise<Row[]> {
    const r = await client.query(
      `WITH period AS (SELECT $2::date AS d0, $3::date AS d1),
       sale_inv AS (
         SELECT i.id, i.customer_id, (i.issued_at AT TIME ZONE $1)::date AS issued_on, i.amount, i.order_id,
                (SELECT SUM(amount) FROM money.invoice_line WHERE invoice_id = i.id) AS taxable
         FROM money.invoice i, period WHERE i.kind = 'sale' AND (i.issued_at AT TIME ZONE $1)::date BETWEEN d0 AND d1
       ),
       paid AS (
         SELECT a.invoice_id, MAX((p.received_at AT TIME ZONE $1)::date) AS paid_on, SUM(a.amount) AS paid
         FROM money.customer_payment_allocation a JOIN money.customer_payment p ON p.id = a.payment_id
         WHERE NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = p.id)
         GROUP BY a.invoice_id
       ),
       inv AS (
         SELECT s.*, CASE WHEN pd.paid >= s.amount THEN pd.paid_on END AS settled_on
         FROM sale_inv s LEFT JOIN paid pd ON pd.invoice_id = s.id
       ),
       cogs AS (
         SELECT o.customer_id, SUM(ll.debit) AS cogs
         FROM money.ledger_entry e JOIN money.ledger_line ll ON ll.entry_id = e.id AND ll.account_code = 'cost_of_goods_sold'
         JOIN commerce.customer_order o ON o.id = e.source_id
         , period WHERE e.entry_type = 'cogs_recognized' AND e.source_type = 'customer_order' AND (e.occurred_at AT TIME ZONE $1)::date BETWEEN d0 AND d1
         GROUP BY o.customer_id
       ),
       stop_kg AS (
         SELECT s.trip_id, o.customer_id,
                COALESCE(SUM(CASE p.base_uom WHEN 'kg' THEN l.quantity WHEN 'g' THEN l.quantity / 1000 END), 0) AS kg
         FROM fulfilment.trip_stop s
         JOIN fulfilment.trip t ON t.id = s.trip_id
         JOIN commerce.customer_order o ON o.id = s.order_id
         JOIN commerce.customer_order_line l ON l.order_id = o.id
         JOIN trading_partners.product p ON p.id = l.product_id
         , period WHERE s.stop_type = 'delivery' AND s.status = 'completed' AND (s.completed_at AT TIME ZONE $1)::date BETWEEN d0 AND d1
         GROUP BY s.trip_id, s.id, o.customer_id
       ),
       trip_cost AS (
         SELECT t.id AS trip_id,
                COALESCE((SELECT SUM(amount) FROM fulfilment.trip_expense WHERE trip_id = t.id), 0)
                + COALESCE((SELECT SUM(amount) FROM fleet.fuel_log WHERE trip_id = t.id), 0) AS cost
         FROM fulfilment.trip t WHERE t.id IN (SELECT trip_id FROM stop_kg)
       ),
       delivery AS (
         SELECT k.customer_id,
                SUM(tc.cost * CASE WHEN tot.kg > 0 THEN k.kg / tot.kg ELSE 1.0 / tot.n END) AS cost
         FROM stop_kg k JOIN trip_cost tc ON tc.trip_id = k.trip_id
         JOIN (SELECT trip_id, SUM(kg) AS kg, count(*) AS n FROM stop_kg GROUP BY trip_id) tot ON tot.trip_id = k.trip_id
         GROUP BY k.customer_id
       ),
       fc AS (
         SELECT i.customer_id, SUM(i.amount) AS amount FROM money.invoice i, period
         WHERE i.kind = 'finance_charge' AND (i.issued_at AT TIME ZONE $1)::date BETWEEN d0 AND d1 GROUP BY i.customer_id
       ),
       crate_rec AS (
         SELECT i.customer_id, SUM(l.amount) AS amount FROM money.invoice i JOIN money.invoice_line l ON l.invoice_id = i.id, period
         WHERE i.kind = 'crate_charge' AND (i.issued_at AT TIME ZONE $1)::date BETWEEN d0 AND d1 GROUP BY i.customer_id
       ),
       crate_lost AS (
         SELECT m.from_id AS customer_id, SUM(m.quantity * ct.replacement_cost) AS amount
         FROM crates.crate_loss cl JOIN crates.movement m ON m.id = cl.movement_id JOIN crates.crate_type ct ON ct.id = m.crate_type_id, period
         WHERE cl.recovery = 'absorbed' AND m.from_kind = 'customer' AND (m.occurred_at AT TIME ZONE $1)::date BETWEEN d0 AND d1
         GROUP BY m.from_id
       ),
       credit AS (
         SELECT customer_id,
                SUM(amount * GREATEST(0, LEAST(COALESCE(settled_on, (SELECT d1 FROM period)), (SELECT d1 FROM period)) - issued_on)) AS rupee_days,
                ROUND(AVG(settled_on - issued_on) FILTER (WHERE settled_on IS NOT NULL))::int AS days_to_pay
         FROM inv GROUP BY customer_id
       )
       SELECT c.id AS customer_id, c.name, c.payment_terms_days,
              count(inv.id)::int AS invoices,
              COALESCE(SUM(inv.taxable), 0)::numeric(14,2)::text AS revenue,
              COALESCE(MAX(cogs.cogs), 0)::numeric(14,2)::text AS cogs,
              COALESCE(MAX(delivery.cost), 0)::numeric(14,2)::text AS delivery_cost,
              COALESCE(MAX(fc.amount), 0)::numeric(14,2)::text AS finance_charges,
              COALESCE(MAX(crate_rec.amount), 0)::numeric(14,2)::text AS crate_recoveries,
              COALESCE(MAX(crate_lost.amount), 0)::numeric(14,2)::text AS crate_losses,
              COALESCE(MAX(credit.rupee_days), 0)::numeric(18,2)::text AS rupee_days,
              MAX(credit.days_to_pay) AS days_to_pay
       FROM trading_partners.customer c
       LEFT JOIN inv ON inv.customer_id = c.id
       LEFT JOIN cogs ON cogs.customer_id = c.id
       LEFT JOIN delivery ON delivery.customer_id = c.id
       LEFT JOIN fc ON fc.customer_id = c.id
       LEFT JOIN crate_rec ON crate_rec.customer_id = c.id
       LEFT JOIN crate_lost ON crate_lost.customer_id = c.id
       LEFT JOIN credit ON credit.customer_id = c.id
       WHERE NOT c.is_walk_in
       GROUP BY c.id, c.name, c.payment_terms_days
       HAVING count(inv.id) > 0`,
      [tz, from, to],
    );
    return r.rows;
  }

  async customerTerms(client: PoolClient): Promise<Map<string, { version: number; creditLimit: string; paymentTermsDays: number; rate: string; grace: number }>> {
    const r = await client.query(
      `SELECT id, version, credit_limit::text, payment_terms_days, finance_charge_rate_monthly::text AS rate, finance_charge_grace_days AS grace
       FROM trading_partners.customer`,
    );
    return new Map(r.rows.map((c) => [c.id as string, { version: c.version, creditLimit: c.credit_limit, paymentTermsDays: c.payment_terms_days, rate: c.rate, grace: c.grace }]));
  }

  // ---- Exceptions ----

  async reconciliations(client: PoolClient, since: Date): Promise<{ trip_id: string; driver_id: string; driver_name: string; variance: string; reconciled_at: Date }[]> {
    const r = await client.query(
      `SELECT r.trip_id, t.driver_employee_id AS driver_id, e.name AS driver_name, r.variance::text, r.reconciled_at
       FROM fulfilment.trip_reconciliation r JOIN fulfilment.trip t ON t.id = r.trip_id JOIN trading_partners.employee e ON e.id = t.driver_employee_id
       WHERE r.reconciled_at >= $1 ORDER BY r.reconciled_at`,
      [since],
    );
    return r.rows;
  }

  /** Invoiced sale lines priced below the cost of the lots that filled them. */
  async salesBelowCost(client: PoolClient, since: Date): Promise<Row[]> {
    const r = await client.query(
      `SELECT i.id AS invoice_id, i.invoice_number, i.customer_id, c.name AS customer_name, l.product_id, l.description,
              l.quantity::text, l.unit_price::text, ROUND(SUM(lot.accepted_quantity * lot.unit_cost) / NULLIF(SUM(lot.accepted_quantity), 0), 2)::text AS unit_cost,
              i.issued_at
       FROM money.invoice i
       JOIN money.invoice_line l ON l.invoice_id = i.id
       JOIN trading_partners.customer c ON c.id = i.customer_id
       JOIN commerce.lot lot ON lot.reserved_for_order_line_id = l.order_line_id AND lot.unit_cost IS NOT NULL
       WHERE i.kind = 'sale' AND i.issued_at >= $1 AND l.order_line_id IS NOT NULL
       GROUP BY i.id, i.invoice_number, i.customer_id, c.name, l.id, l.product_id, l.description, l.quantity, l.unit_price, i.issued_at
       HAVING l.unit_price < ROUND(SUM(lot.accepted_quantity * lot.unit_cost) / NULLIF(SUM(lot.accepted_quantity), 0), 2)`,
      [since],
    );
    return r.rows;
  }

  async tripExpenses(client: PoolClient, since: Date): Promise<{ id: string; trip_id: string; category: string; amount: string; recorded_at: Date; registration_number: string }[]> {
    const r = await client.query(
      `SELECT x.id, x.trip_id, x.category, x.amount::text, x.recorded_at, v.registration_number
       FROM fulfilment.trip_expense x JOIN fulfilment.trip t ON t.id = x.trip_id JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
       WHERE x.recorded_at >= $1`,
      [since],
    );
    return r.rows;
  }

  async fuelFills(client: PoolClient, today: string): Promise<{ id: string; vehicle_id: string; registration_number: string; filled_on: string; litres: string; odometer_km: number }[]> {
    const r = await client.query(
      `SELECT f.id, f.vehicle_id, v.registration_number, f.filled_on::text, f.litres::text, f.odometer_km
       FROM fleet.fuel_log f JOIN trading_partners.vehicle v ON v.id = f.vehicle_id
       WHERE f.odometer_km IS NOT NULL AND f.filled_on >= $1::date - 120
       ORDER BY f.vehicle_id, f.odometer_km`,
      [today],
    );
    return r.rows;
  }

  /** Shrinkage and rejection per product: the last 7 days against the 8 weeks before. */
  async shrinkWindows(client: PoolClient, now: Date): Promise<{ product_id: string; recent_lost: number; recent_accepted: number; base_lost: number; base_accepted: number }[]> {
    const r = await client.query(
      `WITH b AS (SELECT $1::timestamptz AS now)
       SELECT p.id AS product_id,
              COALESCE((SELECT SUM(quantity) FROM stock.inventory_movement m, b WHERE m.product_id = p.id AND m.movement_type IN ('shrinkage', 'rejected_post_acceptance') AND m.created_at >= b.now - interval '7 days'), 0)::float8 AS recent_lost,
              COALESCE((SELECT SUM(accepted_quantity) FROM commerce.lot l, b WHERE l.product_id = p.id AND l.graded_at >= b.now - interval '7 days'), 0)::float8 AS recent_accepted,
              COALESCE((SELECT SUM(quantity) FROM stock.inventory_movement m, b WHERE m.product_id = p.id AND m.movement_type IN ('shrinkage', 'rejected_post_acceptance') AND m.created_at >= b.now - interval '63 days' AND m.created_at < b.now - interval '7 days'), 0)::float8 AS base_lost,
              COALESCE((SELECT SUM(accepted_quantity) FROM commerce.lot l, b WHERE l.product_id = p.id AND l.graded_at >= b.now - interval '63 days' AND l.graded_at < b.now - interval '7 days'), 0)::float8 AS base_accepted
       FROM trading_partners.product p`,
      [now],
    );
    return r.rows;
  }

  async paymentReversals(client: PoolClient, since: Date): Promise<{ customer_id: string; customer_name: string; n: number; amount: string; last_at: Date }[]> {
    const r = await client.query(
      `SELECT p.customer_id, c.name AS customer_name, count(*)::int AS n, SUM(p.amount)::text AS amount, MAX(r.reversed_at) AS last_at
       FROM money.customer_payment_reversal r JOIN money.customer_payment p ON p.id = r.payment_id JOIN trading_partners.customer c ON c.id = p.customer_id
       WHERE r.reversed_at >= $1 GROUP BY p.customer_id, c.name`,
      [since],
    );
    return r.rows;
  }

  /** Every name the inbox may show, resolved at read time (AI System PIPE.5). */
  async names(client: PoolClient): Promise<Map<string, string>> {
    const r = await client.query(
      `SELECT id, name FROM trading_partners.customer UNION ALL SELECT id, name FROM trading_partners.farmer
       UNION ALL SELECT id, name FROM trading_partners.product UNION ALL SELECT id, registration_number FROM trading_partners.vehicle
       UNION ALL SELECT id, name FROM trading_partners.employee`,
    );
    return new Map(r.rows.map((x) => [x.id as string, x.name as string]));
  }
}
