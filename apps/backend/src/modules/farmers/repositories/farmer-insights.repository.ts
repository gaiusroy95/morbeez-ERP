import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface FarmerFiguresRow {
  id: string;
  name: string;
  place: string | null;
  phone: string | null;
  status: 'active' | 'archived';
  route_name: string | null;
  main_product: string | null;
  purchases: string;
  owed: string;
  oldest_unpaid_at: Date | null;
  advance: string;
  paid: string;
  last_paid_at: Date | null;
  last_pickup_at: Date | null;
}

/**
 * Read-only figures for the owner's Farmers list and farmer profile
 * (redesign Phase 5): what each farmer sells, what was bought from them and
 * what they're still owed — from Finance's payable views (money.*) and the
 * lots and purchase orders, never written here.
 */
@Injectable()
export class FarmerInsightsRepository {
  async figuresWithClient(client: PoolClient, farmerId: string | null = null): Promise<FarmerFiguresRow[]> {
    const r = await client.query<FarmerFiguresRow>(
      `WITH payable AS (
         SELECT farmer_id, SUM(amount) AS purchases, SUM(outstanding) AS owed,
                MIN(accrued_at) FILTER (WHERE outstanding > 0) AS oldest_unpaid_at
         FROM money.farmer_payable_balance WHERE $1::uuid IS NULL OR farmer_id = $1
         GROUP BY farmer_id
       ),
       payment AS (
         SELECT farmer_id, SUM(unapplied) AS advance, SUM(amount) AS paid, MAX(paid_at) AS last_paid_at
         FROM money.farmer_payment_balance WHERE $1::uuid IS NULL OR farmer_id = $1
         GROUP BY farmer_id
       ),
       -- What they sell most: by quantity received, else (nothing received yet) by quantity ordered.
       main_lot AS (
         SELECT DISTINCT ON (l.farmer_id) l.farmer_id, p.name AS product
         FROM commerce.lot l JOIN trading_partners.product p ON p.id = l.product_id
         WHERE l.status <> 'rejected' AND ($1::uuid IS NULL OR l.farmer_id = $1)
         GROUP BY l.farmer_id, p.name
         ORDER BY l.farmer_id, SUM(COALESCE(l.accepted_quantity, l.received_quantity)) DESC, p.name
       ),
       main_po AS (
         SELECT DISTINCT ON (po.farmer_id) po.farmer_id, p.name AS product
         FROM commerce.purchase_order po
         JOIN commerce.purchase_order_line pl ON pl.purchase_order_id = po.id
         JOIN trading_partners.product p ON p.id = pl.product_id
         WHERE po.status <> 'cancelled' AND ($1::uuid IS NULL OR po.farmer_id = $1)
         GROUP BY po.farmer_id, p.name
         ORDER BY po.farmer_id, SUM(pl.expected_quantity) DESC, p.name
       ),
       pickups AS (
         SELECT po.farmer_id, MAX(pk.picked_up_at) AS last_pickup_at
         FROM commerce.pickup pk JOIN commerce.purchase_order po ON po.id = pk.purchase_order_id
         WHERE $1::uuid IS NULL OR po.farmer_id = $1
         GROUP BY po.farmer_id
       )
       SELECT f.id, f.name, f.place, f.contact->>'phone' AS phone, f.status, r.name AS route_name,
              COALESCE(main_lot.product, main_po.product) AS main_product,
              ROUND(COALESCE(payable.purchases, 0), 2)::text AS purchases,
              ROUND(COALESCE(payable.owed, 0), 2)::text AS owed,
              payable.oldest_unpaid_at,
              ROUND(COALESCE(payment.advance, 0), 2)::text AS advance,
              ROUND(COALESCE(payment.paid, 0), 2)::text AS paid,
              payment.last_paid_at,
              pickups.last_pickup_at
       FROM trading_partners.farmer f
       LEFT JOIN trading_partners.route_stop rs ON rs.farmer_id = f.id
       LEFT JOIN trading_partners.route r ON r.id = rs.route_id
       LEFT JOIN payable ON payable.farmer_id = f.id
       LEFT JOIN payment ON payment.farmer_id = f.id
       LEFT JOIN main_lot ON main_lot.farmer_id = f.id
       LEFT JOIN main_po ON main_po.farmer_id = f.id
       LEFT JOIN pickups ON pickups.farmer_id = f.id
       WHERE $1::uuid IS NULL OR f.id = $1
       ORDER BY f.name`,
      [farmerId],
    );
    return r.rows;
  }

  /** Their purchase orders: how many, how many open, the last ten. */
  async purchasesWithClient(client: PoolClient, farmerId: string) {
    const summary = await client.query<{ count: number; open: number }>(
      `SELECT (count(*) FILTER (WHERE status <> 'cancelled'))::int AS count,
              (count(*) FILTER (WHERE status IN ('placed', 'confirmed', 'received')))::int AS open
       FROM commerce.purchase_order WHERE farmer_id = $1`,
      [farmerId],
    );
    const recent = await client.query<{ id: string; number: number; day: string; status: string; kg: string; value: string }>(
      `WITH tz AS (SELECT t.timezone FROM tenant.tenant t WHERE t.id = current_tenant_id())
       SELECT po.id, po.number, COALESCE(po.pickup_date, (po.created_at AT TIME ZONE tz.timezone)::date)::text AS day, po.status,
              (SELECT ROUND(COALESCE(SUM(pl.expected_quantity) FILTER (WHERE pr.base_uom = 'kg'), 0), 3)::text
                 FROM commerce.purchase_order_line pl JOIN trading_partners.product pr ON pr.id = pl.product_id
                WHERE pl.purchase_order_id = po.id) AS kg,
              (SELECT ROUND(COALESCE(SUM(pl.expected_quantity * pl.indicative_price), 0), 2)::text
                 FROM commerce.purchase_order_line pl WHERE pl.purchase_order_id = po.id) AS value
       FROM commerce.purchase_order po CROSS JOIN tz
       WHERE po.farmer_id = $1
       ORDER BY po.created_at DESC
       LIMIT 10`,
      [farmerId],
    );
    return { ...summary.rows[0], recent: recent.rows };
  }

  /** What they've sold, product by product: graded quantity, its value at their cost, the average rate. */
  async productsWithClient(client: PoolClient, farmerId: string) {
    const r = await client.query<{ name: string; uom: string; quantity: string; value: string; avg_rate: string | null }>(
      `SELECT p.name, p.base_uom AS uom,
              ROUND(SUM(l.accepted_quantity), 3)::text AS quantity,
              ROUND(SUM(l.accepted_quantity * l.unit_cost), 2)::text AS value,
              ROUND(SUM(l.accepted_quantity * l.unit_cost) / NULLIF(SUM(l.accepted_quantity), 0), 2)::text AS avg_rate
       FROM commerce.lot l JOIN trading_partners.product p ON p.id = l.product_id
       WHERE l.farmer_id = $1 AND l.unit_cost IS NOT NULL AND l.accepted_quantity > 0
       GROUP BY p.name, p.base_uom
       ORDER BY SUM(l.accepted_quantity * l.unit_cost) DESC
       LIMIT 6`,
      [farmerId],
    );
    return r.rows.map((x) => ({ name: x.name, uom: x.uom, quantity: x.quantity, value: x.value, avgRate: x.avg_rate }));
  }

  async paymentsWithClient(client: PoolClient, farmerId: string) {
    const r = await client.query<{ id: string; paid_at: Date; amount: string; method: string; reference: string | null }>(
      `SELECT id, paid_at, amount::text AS amount, method, reference FROM money.farmer_payment
       WHERE farmer_id = $1 ORDER BY paid_at DESC LIMIT 10`,
      [farmerId],
    );
    return r.rows.map((x) => ({ id: x.id, paidAt: x.paid_at, amount: x.amount, method: x.method, reference: x.reference }));
  }

  async pinWithClient(client: PoolClient, farmerId: string): Promise<{ latitude: string; longitude: string } | null> {
    const r = await client.query<{ latitude: string; longitude: string }>(
      "SELECT latitude::text, longitude::text FROM fulfilment.place_pin WHERE kind = 'farmer' AND ref_id = $1",
      [farmerId],
    );
    return r.rows[0] ?? null;
  }
}
