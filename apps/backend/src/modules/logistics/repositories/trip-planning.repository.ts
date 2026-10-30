import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OnTheRoad, PlanOrder, PlanPickup, QuantityRow, TripCard, TripPlan, TripsBoard, TripsBoardDay, VehicleTrips } from '../entities/trip-planning.entity';

// The raw rows of the plan queries (pg returns plain objects).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlanRow = Record<string, any>;

/** A stop on a trip that isn't cancelled and wasn't skipped: the order or pickup is spoken for. */
const ON_ACTIVE_TRIP = `
  SELECT 1 FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
   WHERE s.status <> 'skipped' AND t.status <> 'cancelled'`;

/**
 * Trips as the owner plans and follows them (redesign Phase 4): the
 * Today / Tomorrow / All list, what a trip on a day and route could carry,
 * and a trip's quantities product by product.
 */
@Injectable()
export class TripPlanningRepository {
  async board(client: PoolClient, day: TripsBoardDay, query: string | null, page: number, pageSize: number): Promise<TripsBoard> {
    const q = query?.trim() ? query.trim() : null;
    const base = `
      WITH tz AS (
        SELECT t.timezone, (now() AT TIME ZONE t.timezone)::date AS today FROM tenant.tenant t WHERE t.id = current_tenant_id()
      ),
      tr AS (
        SELECT t.*, COALESCE(t.planned_date, (t.created_at AT TIME ZONE tz.timezone)::date) AS day, tz.today, tz.timezone
        FROM fulfilment.trip t CROSS JOIN tz
      ),
      matching AS (
        SELECT tr.* FROM tr
        JOIN trading_partners.vehicle v ON v.id = tr.vehicle_id
        JOIN trading_partners.employee e ON e.id = tr.driver_employee_id
        LEFT JOIN trading_partners.route r ON r.id = tr.route_id
        WHERE ($1::text IS NULL
               OR tr.number ILIKE '%' || $1 || '%'
               OR r.name ILIKE '%' || $1 || '%'
               OR v.registration_number ILIKE '%' || $1 || '%'
               OR e.name ILIKE '%' || $1 || '%'
               OR EXISTS (SELECT 1 FROM fulfilment.trip_stop s
                            LEFT JOIN commerce.customer_order o ON o.id = s.order_id
                            LEFT JOIN trading_partners.customer c ON c.id = o.customer_id
                            LEFT JOIN commerce.pickup p ON p.id = s.pickup_id
                            LEFT JOIN commerce.purchase_order po ON po.id = p.purchase_order_id
                            LEFT JOIN trading_partners.farmer f ON f.id = po.farmer_id
                           WHERE s.trip_id = tr.id AND COALESCE(c.name, f.name) ILIKE '%' || $1 || '%'))
      )`;
    const counts = await client.query<{ today: number; tomorrow: number; all: number }>(
      `${base}
       SELECT count(*) FILTER (WHERE day = today AND status <> 'cancelled')::int AS today,
              count(*) FILTER (WHERE day = today + 1 AND status <> 'cancelled')::int AS tomorrow,
              count(*)::int AS all
       FROM matching`,
      [q],
    );
    const dayFilter =
      day === 'today' ? "m.day = m.today AND m.status <> 'cancelled'" : day === 'tomorrow' ? "m.day = m.today + 1 AND m.status <> 'cancelled'" : 'true';
    const rows = await client.query(
      `${base}
       SELECT m.id, m.number, m.status, m.day::text AS day,
              CASE WHEN m.status = 'in_progress' THEN to_char(m.started_at AT TIME ZONE m.timezone, 'HH24:MI')
                   WHEN m.status IN ('completed', 'on_hold', 'reconciled') THEN to_char(m.completed_at AT TIME ZONE m.timezone, 'HH24:MI')
              END AS time,
              r.name AS route_name, v.registration_number AS vehicle, e.name AS driver_name,
              (SELECT count(DISTINCT o.customer_id)::int FROM fulfilment.trip_stop s
                 JOIN commerce.customer_order o ON o.id = s.order_id WHERE s.trip_id = m.id) AS customers,
              (SELECT count(DISTINCT po.farmer_id)::int FROM fulfilment.trip_stop s
                 JOIN commerce.pickup p ON p.id = s.pickup_id JOIN commerce.purchase_order po ON po.id = p.purchase_order_id
                WHERE s.trip_id = m.id) AS farmers,
              (SELECT COALESCE(SUM(ol.quantity), 0)::numeric(14,3)::text FROM fulfilment.trip_stop s
                 JOIN commerce.customer_order_line ol ON ol.order_id = s.order_id
                 JOIN trading_partners.product pr ON pr.id = ol.product_id
                WHERE s.trip_id = m.id AND pr.base_uom = 'kg') AS delivery_kg,
              (SELECT COALESCE(SUM(pl.expected_quantity), 0)::numeric(14,3)::text FROM fulfilment.trip_stop s
                 JOIN commerce.pickup p ON p.id = s.pickup_id
                 JOIN commerce.purchase_order_line pl ON pl.purchase_order_id = p.purchase_order_id
                 JOIN trading_partners.product pr ON pr.id = pl.product_id
                WHERE s.trip_id = m.id AND pr.base_uom = 'kg') AS pickup_kg,
              (SELECT count(*)::int FROM fulfilment.trip_stop s WHERE s.trip_id = m.id) AS stops,
              (SELECT count(*)::int FROM fulfilment.trip_stop s WHERE s.trip_id = m.id AND s.status <> 'pending') AS stops_done
       FROM matching m
       JOIN trading_partners.vehicle v ON v.id = m.vehicle_id
       JOIN trading_partners.employee e ON e.id = m.driver_employee_id
       LEFT JOIN trading_partners.route r ON r.id = m.route_id
       WHERE ${dayFilter}
       ORDER BY m.day DESC, m.number
       LIMIT $2 OFFSET $3`,
      [q, pageSize, (page - 1) * pageSize],
    );
    const c = counts.rows[0];
    return {
      day,
      counts: c,
      total: day === 'today' ? c.today : day === 'tomorrow' ? c.tomorrow : c.all,
      page,
      pageSize,
      items: rows.rows.map(
        (r): TripCard => ({
          id: r.id,
          number: r.number,
          status: r.status,
          day: r.day,
          time: r.time,
          routeName: r.route_name,
          customers: r.customers,
          farmers: r.farmers,
          kg: Number(r.delivery_kg) > 0 ? r.delivery_kg : r.pickup_kg,
          vehicle: r.vehicle,
          driverName: r.driver_name,
          stops: r.stops,
          stopsDone: r.stops_done,
        }),
      ),
    };
  }

  /** Trips on the road now, with their crew: who is "On trip" and which vehicles are out (redesign Phase 7). */
  async onTheRoadWithClient(client: PoolClient): Promise<OnTheRoad[]> {
    const result = await client.query<{
      id: string; number: string; vehicle_id: string; driver_employee_id: string;
      packer_employee_id: string | null; loader_employee_id: string | null; started_at: Date | null; route_name: string | null;
    }>(
      `SELECT t.id, t.number, t.vehicle_id, t.driver_employee_id, t.packer_employee_id, t.loader_employee_id, t.started_at, r.name AS route_name
         FROM fulfilment.trip t LEFT JOIN trading_partners.route r ON r.id = t.route_id
        WHERE t.status = 'in_progress'
        ORDER BY t.started_at`,
    );
    return result.rows.map((r) => ({
      tripId: r.id,
      number: r.number,
      vehicleId: r.vehicle_id,
      driverEmployeeId: r.driver_employee_id,
      packerEmployeeId: r.packer_employee_id,
      loaderEmployeeId: r.loader_employee_id,
      startedAt: r.started_at,
      routeName: r.route_name,
    }));
  }

  /**
   * A vehicle's trips (Vehicle details, redesign Phase 7): how many it has
   * made and the kilometres recorded on them (closing − opening KM), who
   * drove and packed its latest, and the latest twenty.
   */
  async vehicleTripsWithClient(client: PoolClient, vehicleId: string): Promise<VehicleTrips> {
    const totals = await client.query<{ trips: number; km: string }>(
      `SELECT count(*) FILTER (WHERE started_at IS NOT NULL)::int AS trips,
              COALESCE(SUM(closing_km - opening_km) FILTER (WHERE closing_km IS NOT NULL AND opening_km IS NOT NULL), 0)::numeric(12,1)::text AS km
         FROM fulfilment.trip WHERE vehicle_id = $1 AND status <> 'cancelled'`,
      [vehicleId],
    );
    const recent = await client.query<{
      id: string; number: string; status: TripCard['status']; day: string; route_name: string | null; km: string | null;
      driver_name: string; driver_phone: string | null; packer_name: string | null;
    }>(
      `SELECT t.id, t.number, t.status,
              COALESCE(t.planned_date, (t.created_at AT TIME ZONE tn.timezone)::date)::text AS day,
              r.name AS route_name,
              CASE WHEN t.closing_km IS NOT NULL AND t.opening_km IS NOT NULL THEN (t.closing_km - t.opening_km)::numeric(12,1)::text END AS km,
              d.name AS driver_name, dp.phone AS driver_phone, p.name AS packer_name
         FROM fulfilment.trip t
         JOIN tenant.tenant tn ON tn.id = t.tenant_id
         JOIN trading_partners.employee d ON d.id = t.driver_employee_id
         LEFT JOIN workforce.worker_profile dp ON dp.employee_id = d.id
         LEFT JOIN trading_partners.employee p ON p.id = t.packer_employee_id
         LEFT JOIN trading_partners.route r ON r.id = t.route_id
        WHERE t.vehicle_id = $1 AND t.status <> 'cancelled'
        ORDER BY day DESC, t.number DESC
        LIMIT 20`,
      [vehicleId],
    );
    const latest = recent.rows[0];
    return {
      vehicleId,
      trips: totals.rows[0].trips,
      km: totals.rows[0].km,
      current: recent.rows.find((r) => r.status === 'in_progress')?.number ?? null,
      crew: latest ? { driverName: latest.driver_name, driverPhone: latest.driver_phone, packerName: latest.packer_name } : null,
      recent: recent.rows.map((r) => ({ id: r.id, number: r.number, status: r.status, day: r.day, routeName: r.route_name, km: r.km, driverName: r.driver_name })),
    };
  }

  async plan(client: PoolClient, date: string, routeId: string | null, vehicleId: string | null): Promise<TripPlan> {
    const orders = await client.query(
      `SELECT o.id, o.number, o.status, o.approval_request_id IS NOT NULL AS awaiting, o.route_id, o.delivery_date::text AS delivery_date,
              c.id AS customer_id, c.name AS customer_name, c.place, to_char(o.delivery_time, 'HH24:MI') AS delivery_time,
              o.planned_driver_id, o.planned_vehicle_id, rs.position AS route_position,
              (SELECT COALESCE(SUM(ol.quantity) FILTER (WHERE pr.base_uom = 'kg'), 0)::numeric(14,3)::text
                 FROM commerce.customer_order_line ol JOIN trading_partners.product pr ON pr.id = ol.product_id WHERE ol.order_id = o.id) AS kg,
              (SELECT json_agg(json_build_object('name', pr.name, 'quantity', ol.quantity::text, 'uom', pr.base_uom) ORDER BY ol.quantity DESC, pr.name)
                 FROM commerce.customer_order_line ol JOIN trading_partners.product pr ON pr.id = ol.product_id WHERE ol.order_id = o.id) AS items,
              (SELECT ROUND(COALESCE(SUM(ol.quantity * ol.unit_price), 0), 2)::text
                 FROM commerce.customer_order_line ol WHERE ol.order_id = o.id) AS total_value
       FROM commerce.customer_order o
       JOIN trading_partners.customer c ON c.id = o.customer_id
       LEFT JOIN trading_partners.route_stop rs ON rs.customer_id = c.id AND rs.route_id = $2
       WHERE o.status IN ('placed', 'confirmed')
         AND (o.delivery_date = $1::date OR (o.delivery_date IS NULL AND o.status = 'confirmed'))
         AND NOT EXISTS (${ON_ACTIVE_TRIP} AND s.order_id = o.id)
       ORDER BY rs.position NULLS LAST, o.number`,
      [date, routeId],
    );
    const pickups = await client.query(
      `WITH tz AS (SELECT t.timezone FROM tenant.tenant t WHERE t.id = current_tenant_id())
       SELECT p.id AS pickup_id, po.id AS po_id, po.number, f.id AS farmer_id, f.name AS farmer_name, f.place,
              to_char(p.scheduled_at AT TIME ZONE tz.timezone, 'HH24:MI') AS time,
              p.driver_employee_id, p.vehicle_id, rs.position AS route_position,
              (SELECT COALESCE(SUM(pl.expected_quantity) FILTER (WHERE pr.base_uom = 'kg'), 0)::numeric(14,3)::text
                 FROM commerce.purchase_order_line pl JOIN trading_partners.product pr ON pr.id = pl.product_id
                WHERE pl.purchase_order_id = po.id) AS kg,
              (SELECT json_agg(json_build_object('name', pr.name, 'quantity', pl.expected_quantity::text, 'uom', pr.base_uom)
                               ORDER BY pl.expected_quantity DESC, pr.name)
                 FROM commerce.purchase_order_line pl JOIN trading_partners.product pr ON pr.id = pl.product_id
                WHERE pl.purchase_order_id = po.id) AS items
       FROM commerce.pickup p
       JOIN commerce.purchase_order po ON po.id = p.purchase_order_id
       JOIN trading_partners.farmer f ON f.id = po.farmer_id
       CROSS JOIN tz
       LEFT JOIN trading_partners.route_stop rs ON rs.farmer_id = f.id AND rs.route_id = $2
       WHERE p.status = 'scheduled'
         AND (COALESCE((p.scheduled_at AT TIME ZONE tz.timezone)::date, po.pickup_date) = $1::date
              OR (p.scheduled_at IS NULL AND po.pickup_date IS NULL))
         AND NOT EXISTS (${ON_ACTIVE_TRIP} AND s.pickup_id = p.id)
       ORDER BY rs.position NULLS LAST, po.number`,
      [date, routeId],
    );
    const vehicle = vehicleId
      ? (
          await client.query(
            `SELECT v.id, v.registration_number, v.capacity_kg::text AS capacity_kg,
                    (SELECT COALESCE(SUM(b.quantity), 0)::numeric(14,3)::text
                       FROM stock.lot_balance b
                       JOIN stock.location loc ON loc.id = b.location_id AND loc.type = 'vehicle'
                       JOIN trading_partners.product pr ON pr.id = b.product_id
                      WHERE loc.vehicle_id = v.id AND pr.base_uom = 'kg') AS stock_kg
             FROM trading_partners.vehicle v WHERE v.id = $1`,
            [vehicleId],
          )
        ).rows[0]
      : null;

    const toOrder = (r: PlanRow): PlanOrder => ({
      id: r.id,
      number: r.number,
      status: r.status,
      awaitingApproval: r.awaiting,
      customerId: r.customer_id,
      customerName: r.customer_name,
      place: r.place,
      deliveryTime: r.delivery_time,
      plannedDriverId: r.planned_driver_id,
      plannedVehicleId: r.planned_vehicle_id,
      routePosition: r.route_position,
      kg: r.kg,
      items: r.items ?? [],
      totalValue: r.total_value,
    });
    const toPickup = (r: PlanRow): PlanPickup => ({
      pickupId: r.pickup_id,
      purchaseOrderId: r.po_id,
      poNumber: r.number,
      farmerId: r.farmer_id,
      farmerName: r.farmer_name,
      place: r.place,
      time: r.time,
      plannedDriverId: r.driver_employee_id,
      plannedVehicleId: r.vehicle_id,
      routePosition: r.route_position,
      kg: r.kg,
      items: r.items ?? [],
    });
    // The route's orders for the day — placed ones too, shown with why they
    // can't go yet; anything else only once it's confirmed.
    const onRoute = (r: PlanRow) => routeId !== null && r.route_id === routeId && r.delivery_date === date;
    return {
      date,
      routeId,
      orders: orders.rows.filter(onRoute).map(toOrder),
      otherOrders: orders.rows.filter((r) => !onRoute(r) && r.status === 'confirmed').map(toOrder),
      pickups: pickups.rows.filter((r) => r.route_position !== null).map(toPickup),
      otherPickups: pickups.rows.filter((r) => r.route_position === null).map(toPickup),
      vehicle: vehicle
        ? { id: vehicle.id, registrationNumber: vehicle.registration_number, capacityKg: vehicle.capacity_kg, stockKg: vehicle.stock_kg }
        : null,
    };
  }

  /** The trip a delivery's order or a pickup is already on, if any (its number). */
  async activeTripOfOrderWithClient(client: PoolClient, orderId: string): Promise<string | null> {
    const found = await client.query<{ number: string }>(
      `SELECT t.number FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
        WHERE s.order_id = $1 AND s.status <> 'skipped' AND t.status <> 'cancelled' LIMIT 1`,
      [orderId],
    );
    return found.rows[0]?.number ?? null;
  }

  async activeTripOfPickupWithClient(client: PoolClient, pickupId: string): Promise<string | null> {
    const found = await client.query<{ number: string }>(
      `SELECT t.number FROM fulfilment.trip_stop s JOIN fulfilment.trip t ON t.id = s.trip_id
        WHERE s.pickup_id = $1 AND s.status <> 'skipped' AND t.status <> 'cancelled' LIMIT 1`,
      [pickupId],
    );
    return found.rows[0]?.number ?? null;
  }

  /** Today in the business's own timezone (YYYY-MM-DD). */
  async todayWithClient(client: PoolClient): Promise<string> {
    const r = await client.query<{ today: string }>(
      'SELECT ((now() AT TIME ZONE t.timezone)::date)::text AS today FROM tenant.tenant t WHERE t.id = current_tenant_id()',
    );
    return r.rows[0].today;
  }

  /** Each customer's and farmer's place in the route's visiting order. */
  async routePositionsWithClient(client: PoolClient, routeId: string): Promise<Map<string, number>> {
    const r = await client.query<{ party_id: string; position: number }>(
      'SELECT COALESCE(customer_id, farmer_id) AS party_id, position FROM trading_partners.route_stop WHERE route_id = $1',
      [routeId],
    );
    return new Map(r.rows.map((x) => [x.party_id, x.position]));
  }

  /**
   * Product by product (driver app D0, stock by the kilo): loaded from the
   * store when the trip started, picked up from farmers (what was accepted
   * — or received, before farm acceptance), delivered (what left with
   * completed deliveries), sold on the spot, and what should be on the
   * vehicle (loaded + procured − delivered − spot sold). Once closed: what
   * came back to the store and what was written off. Still to deliver is
   * what the pending deliveries ask for.
   */
  async quantitiesWithClient(client: PoolClient, tripId: string): Promise<Omit<QuantityRow, 'counted' | 'difference'>[]> {
    const r = await client.query(
      `WITH moves AS (
         SELECT m.product_id,
                CASE WHEN m.movement_type = 'loaded' THEN m.quantity ELSE 0 END AS loaded, 0::numeric AS procured,
                0::numeric AS delivered, 0::numeric AS spot_sold,
                CASE WHEN m.movement_type = 'returned' THEN m.quantity ELSE 0 END AS returned,
                CASE WHEN m.movement_type = 'shrinkage' THEN m.quantity ELSE 0 END AS written_off,
                0::numeric AS to_deliver
         FROM stock.inventory_movement m
         WHERE m.trip_id = $1 AND m.movement_type IN ('loaded', 'returned', 'shrinkage')
         UNION ALL
         SELECT l.product_id, 0, COALESCE(l.accepted_quantity, l.received_quantity), 0, 0, 0, 0, 0
         FROM fulfilment.trip_stop s JOIN commerce.lot l ON l.pickup_id = s.pickup_id
         WHERE s.trip_id = $1 AND s.stop_type = 'pickup' AND s.status = 'completed'
         UNION ALL
         SELECT ol.product_id, 0, 0,
                CASE WHEN s.status = 'completed' THEN COALESCE(ol.delivered_quantity, ol.quantity) ELSE 0 END, 0, 0, 0,
                CASE WHEN s.status = 'pending' THEN ol.quantity ELSE 0 END
         FROM fulfilment.trip_stop s JOIN commerce.customer_order_line ol ON ol.order_id = s.order_id
         WHERE s.trip_id = $1 AND s.stop_type = 'delivery'
         UNION ALL
         SELECT sl.product_id, 0, 0, 0, sl.quantity, 0, 0, 0
         FROM spot.spot_sale ss JOIN spot.spot_sale_line sl ON sl.sale_id = ss.id
         WHERE ss.trip_id = $1 AND ss.status = 'completed'
       )
       SELECT pr.id AS product_id, pr.name AS product, pr.base_uom AS uom,
              SUM(m.loaded)::numeric(14,3)::text AS loaded,
              SUM(m.procured)::numeric(14,3)::text AS procured,
              SUM(m.delivered)::numeric(14,3)::text AS delivered,
              SUM(m.spot_sold)::numeric(14,3)::text AS spot_sold,
              SUM(m.returned)::numeric(14,3)::text AS returned,
              SUM(m.written_off)::numeric(14,3)::text AS written_off,
              SUM(m.to_deliver)::numeric(14,3)::text AS to_deliver,
              (SUM(m.loaded) + SUM(m.procured) - SUM(m.delivered) - SUM(m.spot_sold))::numeric(14,3)::text AS expected
       FROM moves m JOIN trading_partners.product pr ON pr.id = m.product_id
       GROUP BY pr.id, pr.name, pr.base_uom
       ORDER BY pr.name`,
      [tripId],
    );
    return r.rows.map((x) => ({
      productId: x.product_id,
      product: x.product,
      uom: x.uom,
      loaded: x.loaded,
      procured: x.procured,
      delivered: x.delivered,
      spotSold: x.spot_sold,
      returned: x.returned,
      writtenOff: x.written_off,
      toDeliver: x.to_deliver,
      expected: x.expected,
    }));
  }

  /** Every order line on the trip's deliveries still to be made — what goes onto the vehicle when it starts. */
  async pendingDeliveryLineIdsWithClient(client: PoolClient, tripId: string): Promise<string[]> {
    const r = await client.query<{ id: string }>(
      `SELECT ol.id FROM fulfilment.trip_stop s JOIN commerce.customer_order_line ol ON ol.order_id = s.order_id
       WHERE s.trip_id = $1 AND s.stop_type = 'delivery' AND s.status = 'pending'`,
      [tripId],
    );
    return r.rows.map((x) => x.id);
  }

  /**
   * The driver's trip for the day (driver app V1, D1): the one on the road;
   * else the latest the owner planned for today or before (one planned for
   * a later day isn't today's); else the latest one handed in and waiting
   * for the owner to close.
   */
  async dayTripOfDriverWithClient(client: PoolClient, employeeId: string, today: string): Promise<string | null> {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM fulfilment.trip
       WHERE driver_employee_id = $1 AND status IN ('in_progress', 'planned', 'completed', 'on_hold')
         AND (status <> 'planned' OR planned_date IS NULL OR planned_date <= $2::date)
       ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                COALESCE(planned_date, (created_at AT TIME ZONE 'UTC')::date) DESC, created_at DESC
       LIMIT 1`,
      [employeeId, today],
    );
    return r.rows[0]?.id ?? null;
  }

  /** The vehicle's highest odometer reading on record: fuel fills (the fuel log and on trips), maintenance, and trips' opening and closing KM. */
  async lastOdometerWithClient(client: PoolClient, vehicleId: string, exceptTripId: string | null = null): Promise<string | null> {
    const r = await client.query<{ km: string | null }>(
      `SELECT GREATEST(
         (SELECT max(odometer_km) FROM fleet.fuel_log WHERE vehicle_id = $1),
         (SELECT max(odometer_km) FROM fleet.maintenance_record WHERE vehicle_id = $1),
         (SELECT max(opening_km) FROM fulfilment.trip WHERE vehicle_id = $1 AND ($2::uuid IS NULL OR id <> $2)),
         (SELECT max(closing_km) FROM fulfilment.trip WHERE vehicle_id = $1 AND ($2::uuid IS NULL OR id <> $2)),
         (SELECT max(e.odometer_km) FROM fulfilment.trip_expense e JOIN fulfilment.trip t ON t.id = e.trip_id
            WHERE t.vehicle_id = $1 AND ($2::uuid IS NULL OR t.id <> $2))
       )::numeric(10,1)::text AS km`,
      [vehicleId, exceptTripId],
    );
    return r.rows[0]?.km ?? null;
  }

  /** A trip on the same vehicle that set off after this one did (its number) — the vehicle's stock went on with it. */
  async laterTripOnVehicleWithClient(client: PoolClient, tripId: string): Promise<string | null> {
    const r = await client.query<{ number: string }>(
      `SELECT o.number FROM fulfilment.trip t
       JOIN fulfilment.trip o ON o.vehicle_id = t.vehicle_id AND o.id <> t.id
       WHERE t.id = $1 AND o.started_at IS NOT NULL AND o.started_at > COALESCE(t.started_at, '-infinity')
       ORDER BY o.started_at LIMIT 1`,
      [tripId],
    );
    return r.rows[0]?.number ?? null;
  }
}
