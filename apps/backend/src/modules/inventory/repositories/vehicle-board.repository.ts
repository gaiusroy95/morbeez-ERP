import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface VehicleRow {
  vehicle_id: string;
  registration_number: string;
  trip_id: string | null;
  trip_number: string | null;
  driver_name: string | null;
}

export interface VehicleProductRow {
  vehicle_id: string;
  product_id: string;
  product: string;
  uom: string;
  on_vehicle: string;
  reserved: string;
  to_deliver: string;
}

// The vehicle's trip on the road (the latest one to set off), if any.
const ON_THE_ROAD = `SELECT DISTINCT ON (t.vehicle_id) t.vehicle_id, t.id, t.number, t.driver_employee_id
  FROM fulfilment.trip t WHERE t.status = 'in_progress' ORDER BY t.vehicle_id, t.started_at DESC NULLS LAST`;

/**
 * The owner's Vehicle Stock (redesign V1.1, screen 13): a read model across
 * Inventory's stock places, Logistics' trips and Orders' lines — read only,
 * as the dashboard's queries are (System Architecture DB.4).
 */
@Injectable()
export class VehicleBoardRepository {
  /** Vehicles with something aboard or on a trip on the road. */
  async vehiclesWithClient(client: PoolClient): Promise<VehicleRow[]> {
    const r = await client.query<VehicleRow>(
      `WITH road AS (${ON_THE_ROAD}),
       aboard AS (
         SELECT DISTINCT loc.vehicle_id FROM stock.lot_balance b
         JOIN stock.location loc ON loc.id = b.location_id AND loc.type = 'vehicle'
         WHERE b.quantity > 0
       ),
       last_driver AS (
         SELECT DISTINCT ON (t.vehicle_id) t.vehicle_id, t.driver_employee_id
         FROM fulfilment.trip t WHERE t.status <> 'cancelled' ORDER BY t.vehicle_id, t.created_at DESC
       )
       SELECT v.id AS vehicle_id, v.registration_number, road.id AS trip_id, road.number AS trip_number,
              e.name AS driver_name
       FROM trading_partners.vehicle v
       LEFT JOIN road ON road.vehicle_id = v.id
       LEFT JOIN last_driver ld ON ld.vehicle_id = v.id
       LEFT JOIN trading_partners.employee e ON e.id = COALESCE(road.driver_employee_id, ld.driver_employee_id)
       WHERE road.id IS NOT NULL OR v.id IN (SELECT vehicle_id FROM aboard)
       ORDER BY road.id IS NULL, v.registration_number`,
    );
    return r.rows;
  }

  /** Per vehicle and product: what's aboard, what of it is reserved, what its trip on the road still has to deliver. */
  async productsWithClient(client: PoolClient): Promise<VehicleProductRow[]> {
    const r = await client.query<VehicleProductRow>(
      `WITH road AS (${ON_THE_ROAD}),
       aboard AS (
         SELECT loc.vehicle_id, b.product_id, SUM(b.quantity) AS on_vehicle, SUM(b.reserved_quantity) AS reserved
         FROM stock.lot_balance b
         JOIN stock.location loc ON loc.id = b.location_id AND loc.type = 'vehicle'
         WHERE b.quantity > 0
         GROUP BY loc.vehicle_id, b.product_id
       ),
       demand AS (
         SELECT road.vehicle_id, ol.product_id, SUM(ol.quantity) AS to_deliver
         FROM road
         JOIN fulfilment.trip_stop s ON s.trip_id = road.id AND s.stop_type = 'delivery' AND s.status = 'pending'
         JOIN commerce.customer_order_line ol ON ol.order_id = s.order_id
         GROUP BY road.vehicle_id, ol.product_id
       )
       SELECT COALESCE(a.vehicle_id, d.vehicle_id) AS vehicle_id, COALESCE(a.product_id, d.product_id) AS product_id,
              pr.name AS product, pr.base_uom AS uom,
              COALESCE(a.on_vehicle, 0)::numeric(14,3)::text AS on_vehicle,
              COALESCE(a.reserved, 0)::numeric(14,3)::text AS reserved,
              COALESCE(d.to_deliver, 0)::numeric(14,3)::text AS to_deliver
       FROM aboard a
       FULL JOIN demand d ON d.vehicle_id = a.vehicle_id AND d.product_id = a.product_id
       JOIN trading_partners.product pr ON pr.id = COALESCE(a.product_id, d.product_id)
       ORDER BY 1, pr.name`,
    );
    return r.rows;
  }
}
