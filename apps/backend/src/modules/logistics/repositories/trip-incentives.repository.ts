import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TripFacts } from '../../workforce/trip-incentives';

/** A trip's facts for its incentives, with who drove it, which vehicle, and the day. */
export type TripIncentiveFacts = Omit<TripFacts, 'outcome' | 'dayPay' | 'mileage'> & {
  employeeId: string;
  vehicleId: string;
  workDate: string;
};

/**
 * What a trip did, read for the incentive engine (driver app D7): collected,
 * backhaul rent, goods delivered (short or not), stops done, crates brought
 * back, new customers, the hours on the road, and whether its records are
 * complete. Read inside the caller's transaction.
 */
@Injectable()
export class TripIncentivesRepository {
  async factsWithClient(client: PoolClient, tripId: string): Promise<TripIncentiveFacts | null> {
    const r = await client.query(
      `WITH tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id()),
       stops AS (SELECT * FROM fulfilment.trip_stop WHERE trip_id = $1),
       delivered AS (
         SELECT s.id AS stop_id, s.order_id, s.completed_at, o.customer_id FROM stops s
         JOIN commerce.customer_order o ON o.id = s.order_id
         WHERE s.stop_type = 'delivery' AND s.status = 'completed'),
       sales AS (
         SELECT d.*, COALESCE((SELECT SUM(i.amount) FROM money.invoice i WHERE i.order_id = d.order_id AND i.kind = 'sale'), 0) AS value
         FROM delivered d),
       -- A customer never delivered before this trip: their first delivery is on it.
       firsts AS (
         SELECT s.* FROM sales s WHERE NOT EXISTS (
           SELECT 1 FROM fulfilment.trip_stop s2 JOIN commerce.customer_order o2 ON o2.id = s2.order_id
           WHERE o2.customer_id = s.customer_id AND s2.stop_type = 'delivery' AND s2.status = 'completed'
             AND s2.trip_id <> $1 AND s2.completed_at < s.completed_at)),
       back AS (
         SELECT m.quantity, ct.replacement_cost FROM crates.movement m JOIN crates.crate_type ct ON ct.id = m.crate_type_id
         WHERE m.trip_id = $1 AND m.from_kind = 'customer' AND m.kind <> 'correction'
           AND NOT EXISTS (SELECT 1 FROM crates.movement r WHERE r.reverses_movement_id = m.id))
       SELECT t.driver_employee_id, t.vehicle_id,
         COALESCE(t.planned_date, (t.started_at AT TIME ZONE tn.timezone)::date, (t.created_at AT TIME ZONE tn.timezone)::date)::text AS work_date,
         (SELECT COALESCE(SUM(cc.amount), 0) FROM money.customer_collection cc JOIN stops s ON s.id = cc.trip_stop_id)::numeric(14,2)::text AS collected,
         (SELECT COALESCE(SUM(b.amount_received), 0) FROM fulfilment.backhaul b WHERE b.trip_id = $1 AND b.status = 'completed')::numeric(14,2)::text AS backhaul_received,
         (SELECT COALESCE(SUM(value), 0) FROM sales)::numeric(14,2)::text AS delivered_value,
         (SELECT count(*) FROM delivered)::int AS deliveries,
         (SELECT count(DISTINCT sf.trip_stop_id) FROM fulfilment.delivery_shortfall sf JOIN stops s ON s.id = sf.trip_stop_id)::int AS short_deliveries,
         (SELECT count(*) FROM stops)::int AS stops,
         (SELECT count(*) FROM stops WHERE status = 'skipped')::int AS skipped_stops,
         (SELECT COALESCE(SUM(quantity), 0) FROM back)::int AS crates_back,
         (SELECT COALESCE(SUM(quantity * replacement_cost), 0) FROM back)::numeric(14,2)::text AS crates_value,
         (SELECT count(DISTINCT customer_id) FROM firsts)::int AS new_customers,
         (SELECT COALESCE(SUM(value), 0) FROM firsts)::numeric(14,2)::text AS new_customer_value,
         to_char(t.started_at AT TIME ZONE tn.timezone, 'HH24:MI') AS started_at,
         to_char(COALESCE(t.returned_at, t.completed_at) AT TIME ZONE tn.timezone, 'HH24:MI') AS ended_at,
         COALESCE((COALESCE(t.returned_at, t.completed_at) AT TIME ZONE tn.timezone)::date > (t.started_at AT TIME ZONE tn.timezone)::date, false) AS overnight,
         t.opening_km IS NOT NULL AS has_opening_km,
         t.closing_km IS NOT NULL AS has_closing_km,
         (SELECT count(*) FROM delivered d WHERE NOT EXISTS (SELECT 1 FROM fulfilment.trip_stop_photo p WHERE p.trip_stop_id = d.stop_id))::int AS deliveries_without_photo,
         (SELECT count(*) FROM fulfilment.trip_expense e WHERE e.trip_id = $1
            AND NOT EXISTS (SELECT 1 FROM fulfilment.trip_expense_photo p WHERE p.expense_id = e.id))::int AS expenses_without_bill
       FROM fulfilment.trip t CROSS JOIN tn
       WHERE t.id = $1`,
      [tripId],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      employeeId: x.driver_employee_id,
      vehicleId: x.vehicle_id,
      workDate: x.work_date,
      collected: x.collected,
      backhaulReceived: x.backhaul_received,
      deliveredValue: x.delivered_value,
      deliveries: x.deliveries,
      shortDeliveries: x.short_deliveries,
      stops: x.stops,
      skippedStops: x.skipped_stops,
      cratesBack: x.crates_back,
      cratesValue: x.crates_value,
      newCustomers: x.new_customers,
      newCustomerValue: x.new_customer_value,
      startedAt: x.started_at,
      endedAt: x.ended_at,
      overnight: x.overnight,
      hasOpeningKm: x.has_opening_km,
      hasClosingKm: x.has_closing_km,
      deliveriesWithoutPhoto: x.deliveries_without_photo,
      expensesWithoutBill: x.expenses_without_bill,
    };
  }
}
