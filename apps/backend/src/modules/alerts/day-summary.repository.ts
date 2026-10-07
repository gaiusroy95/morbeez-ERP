import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * The evening summary (client Q&A, E: Q20): the day's normal activity —
 * procurement, deliveries, collections, expenses, what's left on hand,
 * customer and driver activity, the trips' economics — read from the
 * records, never kept separately.
 */
export interface DaySummary {
  trips: { started: number; submitted: number; closed: number; open: number };
  procurement: { lots: number; quantity: { uom: string; quantity: string }[]; cost: string };
  deliveries: { done: number; notDelivered: number; customers: number };
  collections: { total: string; byMethod: { method: string; amount: string }[] };
  spotSales: { count: number; total: string };
  expenses: string;
  bankDeposits: string;
  closures: { trips: number; variance: string; withException: number };
  remaining: { product: string; uom: string; quantity: string }[];
  drivers: { name: string; stopsDone: number; collected: string; expenses: string }[];
}

@Injectable()
export class DaySummaryRepository {
  async summaryWithClient(client: PoolClient, from: Date, to: Date): Promise<DaySummary> {
    const w = [from, to];
    const one = async <T>(sql: string, params: unknown[] = w): Promise<T> => (await client.query(sql, params)).rows[0] as T;
    const many = async <T>(sql: string, params: unknown[] = w): Promise<T[]> => (await client.query(sql, params)).rows as T[];

    const [trips, lots, lotQty, deliveries, collections, byMethod, spot, expenses, deposits, closures, remaining, drivers] = await Promise.all([
      one<{ started: string; submitted: string; closed: string; open: string }>(
        `SELECT count(*) FILTER (WHERE started_at >= $1 AND started_at < $2) AS started,
                count(*) FILTER (WHERE completed_at >= $1 AND completed_at < $2) AS submitted,
                (SELECT count(*) FROM fulfilment.trip_reconciliation WHERE reconciled_at >= $1 AND reconciled_at < $2) AS closed,
                count(*) FILTER (WHERE status IN ('in_progress', 'completed', 'on_hold')) AS open
           FROM fulfilment.trip`,
      ),
      one<{ lots: string; cost: string }>(
        `SELECT count(*) AS lots, COALESCE(sum(accepted_quantity * unit_cost), 0)::numeric(14,2)::text AS cost
           FROM commerce.lot WHERE received_at >= $1 AND received_at < $2`,
      ),
      many<{ uom: string; quantity: string }>(
        `SELECT p.base_uom AS uom, sum(l.received_quantity)::text AS quantity
           FROM commerce.lot l JOIN trading_partners.product p ON p.id = l.product_id
          WHERE l.received_at >= $1 AND l.received_at < $2
          GROUP BY p.base_uom ORDER BY p.base_uom`,
      ),
      one<{ done: string; not_delivered: string; customers: string }>(
        `SELECT count(*) FILTER (WHERE s.status = 'completed') AS done,
                count(*) FILTER (WHERE s.status = 'skipped') AS not_delivered,
                count(DISTINCT o.customer_id) FILTER (WHERE s.status = 'completed') AS customers
           FROM fulfilment.trip_stop s
           LEFT JOIN commerce.customer_order o ON o.id = s.order_id
          WHERE s.stop_type = 'delivery' AND s.completed_at >= $1 AND s.completed_at < $2`,
      ),
      one<{ total: string }>(
        `SELECT COALESCE(sum(amount), 0)::numeric(14,2)::text AS total
           FROM money.customer_payment WHERE received_at >= $1 AND received_at < $2`,
      ),
      many<{ method: string; amount: string }>(
        `SELECT method, sum(amount)::numeric(14,2)::text AS amount
           FROM money.customer_payment WHERE received_at >= $1 AND received_at < $2
          GROUP BY method ORDER BY method`,
      ),
      one<{ count: string; total: string }>(
        `SELECT count(*) AS count, COALESCE(sum(total), 0)::numeric(14,2)::text AS total
           FROM spot.spot_sale WHERE status = 'completed' AND completed_at >= $1 AND completed_at < $2`,
      ),
      one<{ total: string }>(
        `SELECT COALESCE(sum(amount), 0)::numeric(14,2)::text AS total
           FROM fulfilment.trip_expense WHERE recorded_at >= $1 AND recorded_at < $2`,
      ),
      one<{ total: string }>(
        `SELECT COALESCE(sum(amount), 0)::numeric(14,2)::text AS total
           FROM fulfilment.trip_cash_deposit WHERE deposited_at >= $1 AND deposited_at < $2`,
      ),
      one<{ trips: string; variance: string; with_exception: string }>(
        `SELECT count(*) AS trips, COALESCE(sum(variance), 0)::numeric(14,2)::text AS variance,
                count(*) FILTER (WHERE outcome = 'approved_exception') AS with_exception
           FROM fulfilment.trip_reconciliation WHERE reconciled_at >= $1 AND reconciled_at < $2`,
      ),
      many<{ product: string; uom: string; quantity: string }>(
        `SELECT p.name AS product, p.base_uom AS uom, sum(l.current_quantity)::text AS quantity
           FROM commerce.lot l JOIN trading_partners.product p ON p.id = l.product_id
          WHERE l.current_quantity > 0
          GROUP BY p.name, p.base_uom ORDER BY p.name
          LIMIT 50`,
        [],
      ),
      many<{ name: string; stops_done: string; collected: string; expenses: string }>(
        `SELECT e.name,
                (SELECT count(*) FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
                  WHERE t.driver_employee_id = e.id AND s.status = 'completed' AND s.completed_at >= $1 AND s.completed_at < $2) AS stops_done,
                (SELECT COALESCE(sum(c.amount), 0)::numeric(14,2)::text FROM money.customer_collection c
                   JOIN fulfilment.trip_stop s ON s.id = c.trip_stop_id JOIN fulfilment.trip t ON t.id = s.trip_id
                  WHERE t.driver_employee_id = e.id AND c.collected_at >= $1 AND c.collected_at < $2) AS collected,
                (SELECT COALESCE(sum(x.amount), 0)::numeric(14,2)::text FROM fulfilment.trip_expense x JOIN fulfilment.trip t ON t.id = x.trip_id
                  WHERE t.driver_employee_id = e.id AND x.recorded_at >= $1 AND x.recorded_at < $2) AS expenses
           FROM trading_partners.employee e
          WHERE e.role_type = 'driver'
            AND EXISTS (SELECT 1 FROM fulfilment.trip t WHERE t.driver_employee_id = e.id
                         AND (t.started_at < $2 AND (t.completed_at IS NULL OR t.completed_at >= $1)))
          ORDER BY e.name`,
      ),
    ]);

    return {
      trips: { started: Number(trips.started), submitted: Number(trips.submitted), closed: Number(trips.closed), open: Number(trips.open) },
      procurement: { lots: Number(lots.lots), quantity: lotQty, cost: lots.cost },
      deliveries: { done: Number(deliveries.done), notDelivered: Number(deliveries.not_delivered), customers: Number(deliveries.customers) },
      collections: { total: collections.total, byMethod },
      spotSales: { count: Number(spot.count), total: spot.total },
      expenses: expenses.total,
      bankDeposits: deposits.total,
      closures: { trips: Number(closures.trips), variance: closures.variance, withException: Number(closures.with_exception) },
      remaining,
      drivers: drivers.map((d) => ({ name: d.name, stopsDone: Number(d.stops_done), collected: d.collected, expenses: d.expenses })),
    };
  }
}
