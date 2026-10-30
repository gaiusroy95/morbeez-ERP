import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/** The trip's delivered customers and what was collected on it (driver app D4). */
@Injectable()
export class TripCollectionsRepository {
  /** Each customer delivered on the trip (not the walk-in buyer), with their last delivery stop on it. */
  async deliveredCustomersWithClient(
    client: PoolClient,
    tripId: string,
  ): Promise<{ customer_id: string; name: string; phone: string | null; place: string | null; stop_id: string; terms_days: number }[]> {
    const r = await client.query(
      `SELECT DISTINCT ON (o.customer_id) o.customer_id, c.name, c.contact->>'phone' AS phone, c.place, s.id AS stop_id,
              COALESCE(o.credit_term_days, c.payment_terms_days) AS terms_days
       FROM fulfilment.trip_stop s
       JOIN commerce.customer_order o ON o.id = s.order_id
       JOIN trading_partners.customer c ON c.id = o.customer_id
       WHERE s.trip_id = $1 AND s.stop_type = 'delivery' AND s.status = 'completed' AND NOT c.is_walk_in
       ORDER BY o.customer_id, s.sequence_number DESC`,
      [tripId],
    );
    return r.rows;
  }

  /** Collected on the trip: by customer, and by method. */
  async collectedWithClient(
    client: PoolClient,
    tripId: string,
  ): Promise<{ byCustomer: Map<string, string>; byMethod: Map<string, string> }> {
    const rows = await client.query<{ customer_id: string; method: string; amount: string }>(
      `SELECT o.customer_id, cc.method, SUM(cc.amount)::numeric(12,2)::text AS amount
       FROM money.customer_collection cc
       JOIN fulfilment.trip_stop s ON s.id = cc.trip_stop_id
       JOIN commerce.customer_order o ON o.id = cc.order_id
       WHERE s.trip_id = $1
       GROUP BY o.customer_id, cc.method`,
      [tripId],
    );
    const byCustomer = new Map<string, string>();
    const byMethod = new Map<string, string>();
    const add = (m: Map<string, string>, k: string, v: string) => m.set(k, (Number(m.get(k) ?? 0) + Number(v)).toFixed(2));
    for (const r of rows.rows) {
      add(byCustomer, r.customer_id, r.amount);
      add(byMethod, r.method, r.amount);
    }
    return { byCustomer, byMethod };
  }

  /** Open disputes on each of [customerIds], by customer. */
  async disputedWithClient(client: PoolClient, customerIds: string[]): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const r = await client.query<{ customer_id: string; amount: string }>(
      `SELECT customer_id, SUM(amount)::numeric(12,2)::text AS amount FROM money.invoice_dispute
       WHERE customer_id = ANY($1::uuid[]) AND status = 'open' GROUP BY customer_id`,
      [customerIds],
    );
    return new Map(r.rows.map((x) => [x.customer_id, x.amount]));
  }

  /** The sale invoice a delivery's order raised. */
  async invoiceOfOrderWithClient(client: PoolClient, orderId: string): Promise<string | null> {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM money.invoice WHERE order_id = $1 AND kind = 'sale' ORDER BY issued_at DESC LIMIT 1`,
      [orderId],
    );
    return r.rows[0]?.id ?? null;
  }

  /** The same dispute raised already (a retried request): never a second one. */
  async sameOpenDisputeWithClient(client: PoolClient, invoiceId: string, amount: string, reason: string, raisedBy: string): Promise<string | null> {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM money.invoice_dispute
       WHERE invoice_id = $1 AND amount = $2::numeric AND reason = $3 AND raised_by = $4 AND status = 'open'
       LIMIT 1`,
      [invoiceId, amount, reason, raisedBy],
    );
    return r.rows[0]?.id ?? null;
  }
}
