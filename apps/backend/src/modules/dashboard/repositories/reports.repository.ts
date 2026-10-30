import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ReportCell } from '../entities/report.entity';

/** At most this many rows in one report (truncated beyond it). */
export const REPORT_ROW_LIMIT = 5000;

type Row = Record<string, ReportCell>;

// The report's dates, in the business's own timezone: [$1, $2] inclusive.
const RANGE = `
  r AS (SELECT (($1::date)::timestamp AT TIME ZONE t.timezone) AS s,
               (($2::date + 1)::timestamp AT TIME ZONE t.timezone) AS e,
               t.timezone AS tz
          FROM tenant.tenant t WHERE t.id = current_tenant_id())`;

/**
 * The queries behind each report (redesign Phase 7): the books and the
 * operations, read across contexts like the rest of the dashboard read
 * model (DB.4). Every query returns at most REPORT_ROW_LIMIT + 1 rows so
 * the service can tell a report was cut short.
 */
@Injectable()
export class ReportsRepository {
  private async rows(client: PoolClient, sql: string, params: unknown[]): Promise<Row[]> {
    const result = await client.query<Row>(`${sql} LIMIT ${REPORT_ROW_LIMIT + 1}`, params);
    return result.rows;
  }

  /** Every sale invoiced in the dates: deliveries and spot sales, with what's still owed on each. */
  sales(client: PoolClient, from: string, to: string): Promise<Row[]> {
    return this.rows(
      client,
      `WITH ${RANGE}
       SELECT (b.issued_at AT TIME ZONE r.tz)::date::text AS date, b.invoice_number AS invoice,
              COALESCE(c.name, 'Walk-in') AS customer, rt.name AS route,
              CASE b.kind WHEN 'spot_sale' THEN 'Spot sale' ELSE 'Delivery' END AS type,
              (SELECT string_agg(DISTINCT p.name, ', ') FROM money.invoice_line il JOIN trading_partners.product p ON p.id = il.product_id
                WHERE il.invoice_id = b.invoice_id) AS products,
              b.amount::text AS amount, b.paid::text AS paid, b.outstanding::text AS balance
         FROM money.invoice_balance b CROSS JOIN r
         LEFT JOIN trading_partners.customer c ON c.id = b.customer_id
         LEFT JOIN commerce.customer_order o ON o.id = b.order_id
         LEFT JOIN trading_partners.route rt ON rt.id = o.route_id
        WHERE b.kind IN ('sale', 'spot_sale') AND b.issued_at >= r.s AND b.issued_at < r.e
        ORDER BY b.issued_at, b.invoice_number`,
      [from, to],
    );
  }

  /** Every lot received from a farmer in the dates, at its rate, and what the farmer is owed for it. */
  procurement(client: PoolClient, from: string, to: string): Promise<Row[]> {
    return this.rows(
      client,
      `WITH ${RANGE}
       SELECT (l.received_at AT TIME ZONE r.tz)::date::text AS date, po.number AS po_number, f.name AS farmer, p.name AS product, p.base_uom AS uom,
              l.received_quantity::text AS received, COALESCE(l.accepted_quantity, l.received_quantity)::text AS accepted,
              l.unit_cost::text AS rate, fp.amount::text AS amount
         FROM commerce.lot l CROSS JOIN r
         JOIN trading_partners.farmer f ON f.id = l.farmer_id
         JOIN trading_partners.product p ON p.id = l.product_id
         LEFT JOIN commerce.purchase_order po ON po.id = l.purchase_order_id
         LEFT JOIN money.farmer_payable fp ON fp.lot_id = l.id
        WHERE l.received_at >= r.s AND l.received_at < r.e
        ORDER BY l.received_at, f.name, p.name`,
      [from, to],
    );
  }

  /**
   * Customer by customer: what was sold to them in the dates (before GST)
   * against the cost of the very kilos delivered (LOT.1), what they paid in
   * the dates, and what they owe now. Walk-in buyers are left out.
   */
  customers(client: PoolClient, from: string, to: string): Promise<Row[]> {
    return this.rows(
      client,
      `WITH ${RANGE},
       sold AS (
         SELECT i.customer_id, il.order_line_id, il.amount
           FROM money.invoice i JOIN money.invoice_line il ON il.invoice_id = i.id CROSS JOIN r
          WHERE i.kind = 'sale' AND i.issued_at >= r.s AND i.issued_at < r.e
       ),
       rev AS (SELECT customer_id, SUM(amount) AS sales FROM sold GROUP BY customer_id),
       cost AS (
         SELECT s.customer_id, SUM(a.delivered_quantity * l.unit_cost) AS cost
           FROM sold s
           JOIN commerce.lot_allocation a ON a.order_line_id = s.order_line_id AND a.delivered_quantity > 0
           JOIN commerce.lot l ON l.id = a.lot_id AND l.unit_cost IS NOT NULL
          GROUP BY s.customer_id
       ),
       paid AS (
         SELECT p.customer_id, SUM(p.amount) AS collected FROM money.customer_payment_balance p CROSS JOIN r
          WHERE p.reversed_at IS NULL AND p.received_at >= r.s AND p.received_at < r.e GROUP BY p.customer_id
       ),
       owed AS (SELECT customer_id, SUM(outstanding) AS outstanding FROM money.invoice_balance GROUP BY customer_id),
       credit AS (SELECT customer_id, SUM(unapplied) AS unapplied FROM money.customer_payment_balance GROUP BY customer_id)
       SELECT c.name AS customer, c.place,
              ROUND(COALESCE(rev.sales, 0), 2)::text AS sales,
              ROUND(COALESCE(cost.cost, 0), 2)::text AS cost,
              ROUND(COALESCE(rev.sales, 0) - COALESCE(cost.cost, 0), 2)::text AS margin,
              CASE WHEN COALESCE(rev.sales, 0) > 0 THEN ROUND((rev.sales - COALESCE(cost.cost, 0)) * 100 / rev.sales, 1)::text END AS margin_pct,
              ROUND(COALESCE(paid.collected, 0), 2)::text AS collected,
              ROUND(COALESCE(owed.outstanding, 0) - COALESCE(credit.unapplied, 0), 2)::text AS outstanding
         FROM trading_partners.customer c
         LEFT JOIN rev ON rev.customer_id = c.id
         LEFT JOIN cost ON cost.customer_id = c.id
         LEFT JOIN paid ON paid.customer_id = c.id
         LEFT JOIN owed ON owed.customer_id = c.id
         LEFT JOIN credit ON credit.customer_id = c.id
        WHERE NOT c.is_walk_in AND (rev.sales IS NOT NULL OR paid.collected IS NOT NULL OR COALESCE(owed.outstanding, 0) - COALESCE(credit.unapplied, 0) <> 0)
        ORDER BY COALESCE(rev.sales, 0) - COALESCE(cost.cost, 0) DESC, c.name`,
      [from, to],
    );
  }

  /** Product by product: what was sold in the dates (deliveries and spot sales, before GST) against the cost of the kilos sold. */
  products(client: PoolClient, from: string, to: string): Promise<Row[]> {
    return this.rows(
      client,
      `WITH ${RANGE},
       sold AS (
         SELECT i.kind, il.product_id, il.order_line_id, il.quantity, il.amount, i.id AS invoice_id
           FROM money.invoice i JOIN money.invoice_line il ON il.invoice_id = i.id CROSS JOIN r
          WHERE i.kind IN ('sale', 'spot_sale') AND i.issued_at >= r.s AND i.issued_at < r.e AND il.product_id IS NOT NULL
       ),
       rev AS (SELECT product_id, SUM(quantity) AS qty, SUM(amount) AS sales FROM sold GROUP BY product_id),
       order_cost AS (
         SELECT s.product_id, SUM(a.delivered_quantity * l.unit_cost) AS cost
           FROM sold s
           JOIN commerce.lot_allocation a ON a.order_line_id = s.order_line_id AND a.delivered_quantity > 0
           JOIN commerce.lot l ON l.id = a.lot_id AND l.unit_cost IS NOT NULL
          WHERE s.kind = 'sale'
          GROUP BY s.product_id
       ),
       spot_cost AS (
         SELECT sl.product_id, SUM(sll.quantity * sll.unit_cost) AS cost
           FROM spot.spot_sale ss JOIN spot.spot_sale_line sl ON sl.sale_id = ss.id JOIN spot.spot_sale_lot sll ON sll.line_id = sl.id
          WHERE ss.invoice_id IN (SELECT invoice_id FROM sold WHERE kind = 'spot_sale')
          GROUP BY sl.product_id
       )
       SELECT p.name AS product, p.base_uom AS uom, ROUND(rev.qty, 3)::text AS sold, ROUND(rev.sales, 2)::text AS sales,
              ROUND(COALESCE(oc.cost, 0) + COALESCE(sc.cost, 0), 2)::text AS cost,
              ROUND(rev.sales - COALESCE(oc.cost, 0) - COALESCE(sc.cost, 0), 2)::text AS profit,
              CASE WHEN rev.sales > 0 THEN ROUND((rev.sales - COALESCE(oc.cost, 0) - COALESCE(sc.cost, 0)) * 100 / rev.sales, 1)::text END AS margin_pct
         FROM rev
         JOIN trading_partners.product p ON p.id = rev.product_id
         LEFT JOIN order_cost oc ON oc.product_id = rev.product_id
         LEFT JOIN spot_cost sc ON sc.product_id = rev.product_id
        ORDER BY rev.sales - COALESCE(oc.cost, 0) - COALESCE(sc.cost, 0) DESC, p.name`,
      [from, to],
    );
  }

  /** Farmer by farmer: the kilos and value bought from them in the dates, what they were paid in the dates, and what they're owed now. */
  farmers(client: PoolClient, from: string, to: string): Promise<Row[]> {
    return this.rows(
      client,
      `WITH ${RANGE},
       kg AS (
         SELECT l.farmer_id, SUM(COALESCE(l.accepted_quantity, l.received_quantity)) FILTER (WHERE p.base_uom = 'kg') AS kg
           FROM commerce.lot l JOIN trading_partners.product p ON p.id = l.product_id CROSS JOIN r
          WHERE l.received_at >= r.s AND l.received_at < r.e GROUP BY l.farmer_id
       ),
       bought AS (
         SELECT fp.farmer_id, SUM(fp.amount) AS purchases FROM money.farmer_payable fp CROSS JOIN r
          WHERE fp.accrued_at >= r.s AND fp.accrued_at < r.e GROUP BY fp.farmer_id
       ),
       paid AS (
         SELECT fp.farmer_id, SUM(fp.amount) AS paid FROM money.farmer_payment_balance fp CROSS JOIN r
          WHERE fp.paid_at >= r.s AND fp.paid_at < r.e GROUP BY fp.farmer_id
       ),
       owed AS (SELECT farmer_id, SUM(outstanding) AS outstanding FROM money.farmer_payable_balance GROUP BY farmer_id)
       SELECT f.name AS farmer, f.place, ROUND(COALESCE(kg.kg, 0), 3)::text AS kg,
              ROUND(COALESCE(bought.purchases, 0), 2)::text AS purchases, ROUND(COALESCE(paid.paid, 0), 2)::text AS paid,
              ROUND(COALESCE(owed.outstanding, 0), 2)::text AS outstanding
         FROM trading_partners.farmer f
         LEFT JOIN kg ON kg.farmer_id = f.id
         LEFT JOIN bought ON bought.farmer_id = f.id
         LEFT JOIN paid ON paid.farmer_id = f.id
         LEFT JOIN owed ON owed.farmer_id = f.id
        WHERE kg.kg IS NOT NULL OR bought.purchases IS NOT NULL OR paid.paid IS NOT NULL OR COALESCE(owed.outstanding, 0) <> 0
        ORDER BY COALESCE(bought.purchases, 0) DESC, f.name`,
      [from, to],
    );
  }

  /** Trip by trip for the days it was planned for: the route, crew, stops, KM, what was delivered and collected, expenses, backhaul. */
  trips(client: PoolClient, from: string, to: string): Promise<Row[]> {
    return this.rows(
      client,
      `WITH ${RANGE}
       SELECT t.number AS trip, COALESCE(t.planned_date, (t.created_at AT TIME ZONE r.tz)::date)::text AS date,
              rt.name AS route, d.name AS driver, v.registration_number AS vehicle, t.status,
              (SELECT count(*) FROM fulfilment.trip_stop s WHERE s.trip_id = t.id AND s.status = 'completed')::int AS stops_done,
              (SELECT count(*) FROM fulfilment.trip_stop s WHERE s.trip_id = t.id)::int AS stops,
              CASE WHEN t.closing_km IS NOT NULL AND t.opening_km IS NOT NULL THEN (t.closing_km - t.opening_km)::numeric(12,1)::text END AS km,
              (SELECT COALESCE(SUM(i.amount), 0) FROM fulfilment.trip_stop s JOIN money.invoice i ON i.order_id = s.order_id AND i.kind = 'sale'
                WHERE s.trip_id = t.id AND s.status = 'completed')::numeric(12,2)::text AS delivered,
              (SELECT COALESCE(SUM(cc.amount), 0) FROM money.customer_collection cc JOIN fulfilment.trip_stop s ON s.id = cc.trip_stop_id
                WHERE s.trip_id = t.id)::numeric(12,2)::text AS collected,
              (SELECT COALESCE(SUM(x.amount), 0) FROM fulfilment.trip_expense x WHERE x.trip_id = t.id)::numeric(12,2)::text AS expenses,
              (SELECT COALESCE(SUM(b.amount_received), 0) FROM fulfilment.backhaul b WHERE b.trip_id = t.id)::numeric(12,2)::text AS backhaul
         FROM fulfilment.trip t CROSS JOIN r
         JOIN trading_partners.employee d ON d.id = t.driver_employee_id
         JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
         LEFT JOIN trading_partners.route rt ON rt.id = t.route_id
        WHERE t.status <> 'cancelled' AND COALESCE(t.planned_date, (t.created_at AT TIME ZONE r.tz)::date) BETWEEN $1::date AND $2::date
        ORDER BY date, t.number`,
      [from, to],
    );
  }

  /** Every customer, with how they buy (export). */
  customerList(client: PoolClient): Promise<Row[]> {
    return this.rows(
      client,
      `SELECT c.name, c.place, c.contact->>'phone' AS phone, c.payment_terms_days AS terms_days, c.credit_limit::text AS credit_limit, c.status
         FROM trading_partners.customer c WHERE NOT c.is_walk_in ORDER BY c.name`,
      [],
    );
  }

  /** Every farmer (export). */
  farmerList(client: PoolClient): Promise<Row[]> {
    return this.rows(
      client,
      `SELECT f.name, f.place, f.contact->>'phone' AS phone, f.status FROM trading_partners.farmer f ORDER BY f.name`,
      [],
    );
  }

  /** Every product (export). */
  productList(client: PoolClient): Promise<Row[]> {
    return this.rows(
      client,
      `SELECT p.name, p.category, p.base_uom AS uom, p.base_price::text AS base_price, p.status FROM trading_partners.product p ORDER BY p.name`,
      [],
    );
  }
}
