import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OrderCard, OrdersBoard, OrdersBoardDay } from '../entities/orders-board.entity';

/**
 * The owner's Delivery Orders list (redesign V1.1, screen 5): one card per
 * order — number, customer and place, products, delivery time, driver,
 * vehicle, and a simple status — for today, tomorrow or all days, with
 * search. "The day" of an order is its delivery date, or the day it was
 * taken when it has none, in the business's own timezone. Products are
 * listed biggest quantity first, so the card leads with the main one.
 */
@Injectable()
export class OrdersBoardRepository {
  async board(client: PoolClient, day: OrdersBoardDay, query: string | null, page: number, pageSize: number): Promise<OrdersBoard> {
    const q = query?.trim() ? query.trim() : null;
    const digits = q && /^d?-?0*\d+$/i.test(q) ? Number(q.replace(/\D/g, '')) : null;
    const base = `
      WITH tz AS (
        SELECT t.timezone, (now() AT TIME ZONE t.timezone)::date AS today FROM tenant.tenant t WHERE t.id = current_tenant_id()
      ),
      o AS (
        SELECT o.*, COALESCE(o.delivery_date, (o.created_at AT TIME ZONE tz.timezone)::date) AS day, tz.today
        FROM commerce.customer_order o CROSS JOIN tz
      ),
      matching AS (
        SELECT o.* FROM o
        JOIN trading_partners.customer c ON c.id = o.customer_id
        LEFT JOIN trading_partners.route r ON r.id = o.route_id
        WHERE ($1::text IS NULL
               OR c.name ILIKE '%' || $1 || '%'
               OR c.place ILIKE '%' || $1 || '%'
               OR r.name ILIKE '%' || $1 || '%'
               OR o.number = $2
               OR EXISTS (SELECT 1 FROM commerce.customer_order_line l JOIN trading_partners.product p ON p.id = l.product_id
                           WHERE l.order_id = o.id AND p.name ILIKE '%' || $1 || '%'))
      )`;

    const counts = await client.query<{ today: number; tomorrow: number; all: number }>(
      `${base}
       SELECT count(*) FILTER (WHERE day = today AND status <> 'cancelled')::int AS today,
              count(*) FILTER (WHERE day = today + 1 AND status <> 'cancelled')::int AS tomorrow,
              count(*)::int AS all
       FROM matching`,
      [q, digits],
    );

    const dayFilter =
      day === 'today' ? "day = today AND status <> 'cancelled'" : day === 'tomorrow' ? "day = today + 1 AND status <> 'cancelled'" : 'true';
    const rows = await client.query(
      `${base},
       on_trip AS (
         SELECT m.*,
                (SELECT row_to_json(st) FROM (
                   SELECT t.status AS trip_status, t.driver_employee_id, t.vehicle_id FROM fulfilment.trip_stop s
                     JOIN fulfilment.trip t ON t.id = s.trip_id
                    WHERE s.order_id = m.id AND s.status <> 'skipped' AND t.status <> 'cancelled'
                    ORDER BY s.created_at DESC LIMIT 1) st) AS stop
         FROM matching m WHERE ${dayFilter}
       )
       SELECT p.id, p.number, p.status, p.approval_request_id, p.day::text AS day,
              to_char(p.delivery_time, 'HH24:MI') AS delivery_time,
              c.name AS customer_name, c.place AS customer_place, r.name AS route_name,
              e.name AS driver_name, v.registration_number AS vehicle,
              p.stop->>'trip_status' AS trip_status,
              (SELECT json_agg(json_build_object('name', pr.name, 'quantity', l.quantity::text, 'uom', pr.base_uom)
                               ORDER BY l.quantity DESC, pr.name)
                 FROM commerce.customer_order_line l JOIN trading_partners.product pr ON pr.id = l.product_id
                WHERE l.order_id = p.id) AS products,
              (SELECT ROUND(COALESCE(SUM(l.quantity * l.unit_price), 0), 2)::text
                 FROM commerce.customer_order_line l WHERE l.order_id = p.id) AS total_value
       FROM on_trip p
       JOIN trading_partners.customer c ON c.id = p.customer_id
       LEFT JOIN trading_partners.route r ON r.id = p.route_id
       LEFT JOIN trading_partners.employee e ON e.id = COALESCE((p.stop->>'driver_employee_id')::uuid, p.planned_driver_id)
       LEFT JOIN trading_partners.vehicle v ON v.id = COALESCE((p.stop->>'vehicle_id')::uuid, p.planned_vehicle_id)
       ORDER BY p.day DESC, p.delivery_time NULLS LAST, p.number DESC
       LIMIT $3 OFFSET $4`,
      [q, digits, pageSize, (page - 1) * pageSize],
    );

    const total = day === 'today' ? counts.rows[0].today : day === 'tomorrow' ? counts.rows[0].tomorrow : counts.rows[0].all;
    return {
      day,
      counts: counts.rows[0],
      total,
      page,
      pageSize,
      items: rows.rows.map(
        (r): OrderCard => ({
          id: r.id,
          number: r.number,
          status: r.status,
          stage:
            r.status === 'cancelled'
              ? 'cancelled'
              : r.status === 'delivered'
                ? 'completed'
                : r.trip_status === 'planned'
                  ? 'scheduled'
                  : r.trip_status
                    ? 'in_transit'
                    : r.status === 'placed' && r.approval_request_id
                      ? 'awaiting_approval'
                      : 'pending',
          day: r.day,
          deliveryTime: r.delivery_time,
          customerName: r.customer_name,
          customerPlace: r.customer_place,
          routeName: r.route_name,
          driverName: r.driver_name,
          vehicle: r.vehicle,
          products: r.products ?? [],
          totalValue: r.total_value,
        }),
      ),
    };
  }
}
