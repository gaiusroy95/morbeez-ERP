import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/** One customer's figures, as the list and the profile both read them. */
export interface CustomerFiguresRow {
  id: string;
  name: string;
  place: string | null;
  phone: string | null;
  status: 'active' | 'archived';
  credit_hold: boolean;
  credit_limit: string;
  route_id: string | null;
  route_name: string | null;
  sales: string;
  outstanding: string;
  overdue: string;
  oldest_overdue_days: number | null;
  settled: number;
  on_time: number;
  avg_days: number | null;
  on_account: string;
  open_orders: string;
}

/**
 * Read-only figures for the owner's Customers list and Customer Profile
 * (redesign Phase 5): what each customer bought, owes, and how they pay —
 * from Finance's balance views (money.*) and the orders, never written here.
 * An invoice counts as settled the day the payment that completed it came
 * in (the same rule as the AI's profitability report).
 */
@Injectable()
export class CustomerInsightsRepository {
  async figuresWithClient(client: PoolClient, customerId: string | null = null): Promise<CustomerFiguresRow[]> {
    const r = await client.query<CustomerFiguresRow>(
      `WITH tz AS (
         SELECT t.timezone, (now() AT TIME ZONE t.timezone)::date AS today FROM tenant.tenant t WHERE t.id = current_tenant_id()
       ),
       inv AS (
         SELECT b.customer_id,
                SUM(b.amount) FILTER (WHERE b.kind = 'sale') AS sales,
                SUM(b.outstanding) AS outstanding,
                SUM(b.outstanding) FILTER (WHERE b.due_date < tz.today) AS overdue,
                MAX(tz.today - b.due_date) FILTER (WHERE b.outstanding > 0 AND b.due_date < tz.today) AS oldest_overdue_days
         FROM money.invoice_balance b CROSS JOIN tz
         WHERE $1::uuid IS NULL OR b.customer_id = $1
         GROUP BY b.customer_id
       ),
       paid AS (
         SELECT a.invoice_id, MAX((p.received_at AT TIME ZONE tz.timezone)::date) AS paid_on, SUM(a.amount) AS paid
         FROM money.customer_payment_allocation a JOIN money.customer_payment p ON p.id = a.payment_id CROSS JOIN tz
         WHERE NOT EXISTS (SELECT 1 FROM money.customer_payment_reversal r WHERE r.payment_id = p.id)
           AND ($1::uuid IS NULL OR p.customer_id = $1)
         GROUP BY a.invoice_id
       ),
       behaviour AS (
         SELECT i.customer_id,
                count(*)::int AS settled,
                (count(*) FILTER (WHERE pd.paid_on <= i.due_date))::int AS on_time,
                ROUND(AVG(pd.paid_on - (i.issued_at AT TIME ZONE tz.timezone)::date))::int AS avg_days
         FROM money.invoice i JOIN paid pd ON pd.invoice_id = i.id CROSS JOIN tz
         WHERE i.kind = 'sale' AND pd.paid >= i.amount
         GROUP BY i.customer_id
       ),
       held AS (
         SELECT customer_id, SUM(unapplied) AS on_account FROM money.customer_payment_balance
         WHERE $1::uuid IS NULL OR customer_id = $1 GROUP BY customer_id
       ),
       open_orders AS (
         SELECT o.customer_id, SUM(ol.quantity * ol.unit_price) AS value
         FROM commerce.customer_order o JOIN commerce.customer_order_line ol ON ol.order_id = o.id
         WHERE o.status = 'confirmed' AND ($1::uuid IS NULL OR o.customer_id = $1)
         GROUP BY o.customer_id
       )
       SELECT c.id, c.name, c.place, c.contact->>'phone' AS phone, c.status, c.credit_hold, c.credit_limit::text AS credit_limit,
              rs.route_id, r.name AS route_name,
              ROUND(COALESCE(inv.sales, 0), 2)::text AS sales,
              ROUND(COALESCE(inv.outstanding, 0), 2)::text AS outstanding,
              ROUND(COALESCE(inv.overdue, 0), 2)::text AS overdue,
              inv.oldest_overdue_days,
              COALESCE(bh.settled, 0) AS settled, COALESCE(bh.on_time, 0) AS on_time, bh.avg_days,
              ROUND(COALESCE(held.on_account, 0), 2)::text AS on_account,
              ROUND(COALESCE(oo.value, 0), 2)::text AS open_orders
       FROM trading_partners.customer c
       LEFT JOIN trading_partners.route_stop rs ON rs.customer_id = c.id
       LEFT JOIN trading_partners.route r ON r.id = rs.route_id
       LEFT JOIN inv ON inv.customer_id = c.id
       LEFT JOIN behaviour bh ON bh.customer_id = c.id
       LEFT JOIN held ON held.customer_id = c.id
       LEFT JOIN open_orders oo ON oo.customer_id = c.id
       WHERE NOT c.is_walk_in AND ($1::uuid IS NULL OR c.id = $1)
       ORDER BY c.name`,
      [customerId],
    );
    return r.rows;
  }

  /** Sales in the last 30 days and the 30 before (invoices issued, by the business's calendar). */
  async salesTrendWithClient(client: PoolClient, customerId: string): Promise<{ last30: string; previous30: string }> {
    const r = await client.query<{ last30: string; previous30: string }>(
      `WITH tz AS (SELECT t.timezone, (now() AT TIME ZONE t.timezone)::date AS today FROM tenant.tenant t WHERE t.id = current_tenant_id())
       SELECT ROUND(COALESCE(SUM(i.amount) FILTER (WHERE (i.issued_at AT TIME ZONE tz.timezone)::date > tz.today - 30), 0), 2)::text AS last30,
              ROUND(COALESCE(SUM(i.amount) FILTER (WHERE (i.issued_at AT TIME ZONE tz.timezone)::date <= tz.today - 30
                                                     AND (i.issued_at AT TIME ZONE tz.timezone)::date > tz.today - 60), 0), 2)::text AS previous30
       FROM money.invoice i CROSS JOIN tz
       WHERE i.customer_id = $1 AND i.kind = 'sale'`,
      [customerId],
    );
    return r.rows[0];
  }

  /** Goods sold to them before GST, their cost (cost of goods recognised at delivery), and the top products. */
  async marginWithClient(
    client: PoolClient,
    customerId: string,
  ): Promise<{ revenue: string; cogs: string; topProducts: { name: string; uom: string; quantity: string; revenue: string }[] }> {
    const totals = await client.query<{ revenue: string; cogs: string }>(
      `SELECT
         (SELECT ROUND(COALESCE(SUM(l.amount), 0), 2)::text
            FROM money.invoice i JOIN money.invoice_line l ON l.invoice_id = i.id
           WHERE i.customer_id = $1 AND i.kind = 'sale') AS revenue,
         (SELECT ROUND(COALESCE(SUM(ll.debit), 0), 2)::text
            FROM money.ledger_entry e
            JOIN money.ledger_line ll ON ll.entry_id = e.id AND ll.account_code = 'cost_of_goods_sold'
            JOIN commerce.customer_order o ON o.id = e.source_id
           WHERE e.entry_type = 'cogs_recognized' AND e.source_type = 'customer_order' AND o.customer_id = $1) AS cogs`,
      [customerId],
    );
    const products = await client.query<{ name: string; uom: string; quantity: string; revenue: string }>(
      `SELECT p.name, p.base_uom AS uom, ROUND(SUM(l.quantity), 3)::text AS quantity, ROUND(SUM(l.amount), 2)::text AS revenue
       FROM money.invoice i JOIN money.invoice_line l ON l.invoice_id = i.id
       JOIN trading_partners.product p ON p.id = l.product_id
       WHERE i.customer_id = $1 AND i.kind = 'sale'
       GROUP BY p.name, p.base_uom
       ORDER BY SUM(l.amount) DESC
       LIMIT 5`,
      [customerId],
    );
    return { ...totals.rows[0], topProducts: products.rows };
  }

  /** Their orders: how many, average value, the latest, and the last ten. */
  async ordersWithClient(client: PoolClient, customerId: string) {
    const summary = await client.query<{ count: number; avg_value: string | null; last_order_at: Date | null }>(
      `SELECT count(*)::int AS count,
              ROUND(AVG(v.value), 2)::text AS avg_value,
              MAX(o.created_at) AS last_order_at
       FROM commerce.customer_order o
       LEFT JOIN LATERAL (SELECT SUM(ol.quantity * ol.unit_price) AS value FROM commerce.customer_order_line ol WHERE ol.order_id = o.id) v ON true
       WHERE o.customer_id = $1 AND o.status <> 'cancelled'`,
      [customerId],
    );
    const recent = await client.query<{ id: string; number: number; day: string; status: string; total: string }>(
      `WITH tz AS (SELECT t.timezone FROM tenant.tenant t WHERE t.id = current_tenant_id())
       SELECT o.id, o.number, COALESCE(o.delivery_date, (o.created_at AT TIME ZONE tz.timezone)::date)::text AS day, o.status,
              (SELECT ROUND(COALESCE(SUM(ol.quantity * ol.unit_price), 0), 2)::text FROM commerce.customer_order_line ol WHERE ol.order_id = o.id) AS total
       FROM commerce.customer_order o CROSS JOIN tz
       WHERE o.customer_id = $1
       ORDER BY o.created_at DESC
       LIMIT 10`,
      [customerId],
    );
    return { ...summary.rows[0], recent: recent.rows };
  }

  /** Their map pin (Logistics), if one is set. */
  async pinWithClient(client: PoolClient, kind: 'customer' | 'farmer', id: string): Promise<{ latitude: string; longitude: string } | null> {
    const r = await client.query<{ latitude: string; longitude: string }>(
      'SELECT latitude::text, longitude::text FROM fulfilment.place_pin WHERE kind = $1 AND ref_id = $2',
      [kind, id],
    );
    return r.rows[0] ?? null;
  }
}
