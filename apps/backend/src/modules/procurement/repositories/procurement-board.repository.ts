import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ProcurementBoard, ProcurementBoardDay, ProcurementCard } from '../entities/procurement-board.entity';

/**
 * The owner's Procurement list (redesign V1.1, screen 3): one card per
 * purchase order — number, farmer and place, products, pickup time,
 * driver, vehicle, and a simple status — for today, tomorrow or all days,
 * with search. Products are listed biggest quantity first, so the card
 * leads with the main one. "The day" of an order is its pickup date, or the day it was
 * raised when it has none, in the business's own timezone.
 */
@Injectable()
export class ProcurementBoardRepository {
  async board(
    client: PoolClient,
    day: ProcurementBoardDay,
    query: string | null,
    page: number,
    pageSize: number,
  ): Promise<ProcurementBoard> {
    const q = query?.trim() ? query.trim() : null;
    const digits = q && /^p?-?0*\d+$/i.test(q) ? Number(q.replace(/\D/g, '')) : null;
    const base = `
      WITH tz AS (
        SELECT t.timezone, (now() AT TIME ZONE t.timezone)::date AS today FROM tenant.tenant t WHERE t.id = current_tenant_id()
      ),
      po AS (
        SELECT po.*, COALESCE(po.pickup_date, (po.created_at AT TIME ZONE tz.timezone)::date) AS day, tz.today, tz.timezone
        FROM commerce.purchase_order po CROSS JOIN tz
      ),
      matching AS (
        SELECT po.* FROM po
        JOIN trading_partners.farmer f ON f.id = po.farmer_id
        WHERE ($1::text IS NULL
               OR f.name ILIKE '%' || $1 || '%'
               OR f.place ILIKE '%' || $1 || '%'
               OR po.number = $2
               OR EXISTS (SELECT 1 FROM commerce.purchase_order_line l JOIN trading_partners.product p ON p.id = l.product_id
                           WHERE l.purchase_order_id = po.id AND p.name ILIKE '%' || $1 || '%'))
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
       picked AS (
         SELECT m.*,
                (SELECT row_to_json(pk) FROM (
                   SELECT k.scheduled_at, k.status, k.driver_employee_id, k.vehicle_id FROM commerce.pickup k
                    WHERE k.purchase_order_id = m.id AND k.status <> 'cancelled'
                    ORDER BY k.created_at DESC LIMIT 1) pk) AS pickup
         FROM matching m WHERE ${dayFilter}
       )
       SELECT p.id, p.number, p.status, p.approval_request_id, p.day::text AS day,
              f.name AS farmer_name, f.place AS farmer_place,
              COALESCE(to_char((p.pickup->>'scheduled_at')::timestamptz AT TIME ZONE p.timezone, 'HH24:MI'),
                       to_char(p.pickup_time, 'HH24:MI')) AS pickup_time,
              e.name AS driver_name, v.registration_number AS vehicle,
              (p.pickup->>'status') = 'completed' AS picked_up,
              (SELECT json_agg(json_build_object('name', pr.name, 'quantity', l.expected_quantity::text, 'uom', pr.base_uom,
                                                 'bags', l.bags::text, 'kgPerBag', l.kg_per_bag::text) ORDER BY l.expected_quantity DESC, pr.name)
                 FROM commerce.purchase_order_line l JOIN trading_partners.product pr ON pr.id = l.product_id
                WHERE l.purchase_order_id = p.id) AS products,
              (SELECT ROUND(COALESCE(SUM(l.expected_quantity * l.indicative_price), 0), 2)::text
                 FROM commerce.purchase_order_line l WHERE l.purchase_order_id = p.id) AS expected_value
       FROM picked p
       JOIN trading_partners.farmer f ON f.id = p.farmer_id
       LEFT JOIN trading_partners.employee e ON e.id = COALESCE((p.pickup->>'driver_employee_id')::uuid, p.planned_driver_id)
       LEFT JOIN trading_partners.vehicle v ON v.id = COALESCE((p.pickup->>'vehicle_id')::uuid, p.planned_vehicle_id)
       ORDER BY p.day DESC, pickup_time NULLS LAST, p.number DESC
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
        (r): ProcurementCard => ({
          id: r.id,
          number: r.number,
          status: r.status,
          stage:
            r.status === 'cancelled'
              ? 'cancelled'
              : r.status === 'graded' || r.status === 'closed'
                ? 'completed'
                : r.status === 'received' || r.picked_up
                  ? 'in_progress'
                  : r.status === 'placed' && r.approval_request_id
                    ? 'awaiting_approval'
                    : 'pending',
          day: r.day,
          pickupTime: r.pickup_time,
          farmerName: r.farmer_name,
          farmerPlace: r.farmer_place,
          driverName: r.driver_name,
          vehicle: r.vehicle,
          products: r.products ?? [],
          expectedValue: r.expected_value,
        }),
      ),
    };
  }
}
