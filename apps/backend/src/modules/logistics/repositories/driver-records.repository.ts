import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TripStatus } from '../entities/trip.entity';
import { ExpenseCategory } from '../entities/trip-expense.entity';
import { TripExpenseRow, toExpenseRecord } from './trip-expenses.repository';
import { TripExpenseRecord } from '../entities/trip-expense.entity';

/** A trip's day: the one it was planned for, else the day it set off, in the business's timezone. */
const TRIP_DAY = `COALESCE(t.planned_date, (t.started_at AT TIME ZONE tn.timezone)::date, (t.created_at AT TIME ZONE tn.timezone)::date)`;
const TZ = `tn AS (SELECT timezone FROM tenant.tenant WHERE id = current_tenant_id())`;

/** Someone's name: their worker record, else their login. Its own aliases, so it reads the caller's column. */
const NAME_OF = (user: string) => `
  COALESCE((SELECT nm_e.name FROM trading_partners.employee nm_e WHERE nm_e.user_id = ${user} ORDER BY nm_e.created_at LIMIT 1),
           (SELECT COALESCE(nm_u.phone, nm_u.email::text) FROM identity.app_user nm_u WHERE nm_u.id = ${user}))`;

export interface TripCardRow {
  id: string;
  number: string;
  day: string | null;
  status: TripStatus;
  route_name: string | null;
  places: (string | null)[] | null;
  pickups_done: number;
  pickups: number;
  deliveries_done: number;
  deliveries: number;
  collected: string;
  backhaul_received: string;
  km: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  fuel_litres: string;
}

export interface DriverExpenseRow extends TripExpenseRecord {
  tripNumber: string;
  tripStatus: TripStatus;
}

export interface ApprovalRow {
  id: string;
  kind: 'expense' | 'collection' | 'handover';
  raw_status: string;
  amount: string | null;
  category: ExpenseCategory | null;
  customer_name: string | null;
  detail: string | null;
  trip_id: string | null;
  trip_number: string | null;
  trip_status: TripStatus | null;
  needs_approval: boolean;
  decision: 'approved' | 'rejected' | null;
  review_note: string | null;
  note: string | null;
  at: Date;
  decided_at: Date | null;
  photos: number;
}

/**
 * The driver's own records (driver app D6): read-only queries, always
 * narrowed to the one driver's trips (or what they raised) — never a
 * client-supplied filter (DRV.14).
 */
@Injectable()
export class DriverRecordsRepository {
  /** The driver's trips that set off, on days in the range, each with what it did. */
  async tripCardsWithClient(client: PoolClient, employeeId: string, from: string, to: string, tripId: string | null = null): Promise<TripCardRow[]> {
    const r = await client.query<TripCardRow>(
      `WITH ${TZ}
       SELECT t.id, t.number, ${TRIP_DAY}::text AS day, t.status, rt.name AS route_name,
         (SELECT array_agg(x.place ORDER BY x.seq) FROM (
            SELECT s.sequence_number AS seq, c.place FROM fulfilment.trip_stop s
              JOIN commerce.customer_order o ON o.id = s.order_id JOIN trading_partners.customer c ON c.id = o.customer_id WHERE s.trip_id = t.id
            UNION ALL
            SELECT s.sequence_number, f.place FROM fulfilment.trip_stop s JOIN commerce.pickup p ON p.id = s.pickup_id
              JOIN commerce.purchase_order po ON po.id = p.purchase_order_id JOIN trading_partners.farmer f ON f.id = po.farmer_id WHERE s.trip_id = t.id
          ) x) AS places,
         (SELECT count(*) FILTER (WHERE s.status = 'completed') FROM fulfilment.trip_stop s WHERE s.trip_id = t.id AND s.stop_type = 'pickup')::int AS pickups_done,
         (SELECT count(*) FROM fulfilment.trip_stop s WHERE s.trip_id = t.id AND s.stop_type = 'pickup')::int AS pickups,
         (SELECT count(*) FILTER (WHERE s.status = 'completed') FROM fulfilment.trip_stop s WHERE s.trip_id = t.id AND s.stop_type = 'delivery')::int AS deliveries_done,
         (SELECT count(*) FROM fulfilment.trip_stop s WHERE s.trip_id = t.id AND s.stop_type = 'delivery')::int AS deliveries,
         (SELECT COALESCE(SUM(cc.amount), 0) FROM money.customer_collection cc JOIN fulfilment.trip_stop s ON s.id = cc.trip_stop_id
            WHERE s.trip_id = t.id)::numeric(14,2)::text AS collected,
         (SELECT COALESCE(SUM(b.amount_received), 0) FROM fulfilment.backhaul b WHERE b.trip_id = t.id AND b.status = 'completed')::numeric(14,2)::text AS backhaul_received,
         CASE WHEN t.opening_km IS NOT NULL AND t.closing_km IS NOT NULL THEN (t.closing_km - t.opening_km)::numeric(10,1)::text END AS km,
         t.started_at, COALESCE(t.returned_at, t.completed_at) AS ended_at,
         (SELECT COALESCE(SUM(e.litres), 0) FROM fulfilment.trip_expense e WHERE e.trip_id = t.id)::numeric(10,3)::text AS fuel_litres
       FROM fulfilment.trip t CROSS JOIN tn
       LEFT JOIN trading_partners.route rt ON rt.id = t.route_id
       WHERE t.driver_employee_id = $1 AND t.status IN ('in_progress', 'completed', 'on_hold', 'reconciled')
         AND ($4::uuid IS NULL OR t.id = $4)
         AND ($4::uuid IS NOT NULL OR ${TRIP_DAY} BETWEEN $2 AND $3)
       ORDER BY ${TRIP_DAY} DESC, t.started_at DESC NULLS LAST, t.created_at DESC
       LIMIT 200`,
      [employeeId, from, to, tripId],
    );
    return r.rows;
  }

  /** The driver's expenses recorded on days in the range, newest first, with their trip. */
  async expensesWithClient(client: PoolClient, employeeId: string, from: string, to: string): Promise<DriverExpenseRow[]> {
    const rows = await client.query<TripExpenseRow & { trip_number: string; trip_status: TripStatus }>(
      `WITH ${TZ}
       SELECT e.*, (SELECT count(*)::int FROM fulfilment.trip_expense_photo p WHERE p.expense_id = e.id) AS photos,
              t.number AS trip_number, t.status AS trip_status
       FROM fulfilment.trip_expense e JOIN fulfilment.trip t ON t.id = e.trip_id CROSS JOIN tn
       WHERE t.driver_employee_id = $1 AND (e.recorded_at AT TIME ZONE tn.timezone)::date BETWEEN $2 AND $3
       ORDER BY e.recorded_at DESC
       LIMIT 500`,
      [employeeId, from, to],
    );
    return rows.rows.map((row) => ({ ...toExpenseRecord(row), tripNumber: row.trip_number, tripStatus: row.trip_status }));
  }

  /**
   * What the driver raised that the owner decides, since a day: expenses
   * beyond their authority, disputes they raised, trips they handed over.
   */
  async approvalsWithClient(client: PoolClient, employeeId: string, userId: string, since: string): Promise<ApprovalRow[]> {
    const r = await client.query<ApprovalRow>(
      `WITH ${TZ}
       SELECT * FROM (
         SELECT e.id, 'expense' AS kind, COALESCE(e.decision, 'pending') AS raw_status, e.amount::text AS amount, e.category,
                NULL::text AS customer_name, e.notes AS detail, t.id AS trip_id, t.number AS trip_number, t.status AS trip_status,
                e.needs_approval, e.decision, NULL::text AS review_note, e.decision_note AS note, e.recorded_at AS at, e.decided_at,
                (SELECT count(*)::int FROM fulfilment.trip_expense_photo p WHERE p.expense_id = e.id) AS photos
         FROM fulfilment.trip_expense e JOIN fulfilment.trip t ON t.id = e.trip_id CROSS JOIN tn
         WHERE t.driver_employee_id = $1 AND e.needs_approval AND (e.recorded_at AT TIME ZONE tn.timezone)::date >= $3
         UNION ALL
         SELECT d.id, 'collection', d.status, d.amount::text, NULL, c.name, d.reason, t.id, t.number, t.status,
                false, NULL, NULL, d.resolution, d.raised_at, d.resolved_at, 0
         FROM money.invoice_dispute d CROSS JOIN tn
         JOIN trading_partners.customer c ON c.id = d.customer_id
         JOIN money.invoice i ON i.id = d.invoice_id
         LEFT JOIN LATERAL (
           SELECT tt.id, tt.number, tt.status FROM fulfilment.trip_stop s JOIN fulfilment.trip tt ON tt.id = s.trip_id
           WHERE s.order_id = i.order_id ORDER BY tt.created_at DESC LIMIT 1) t ON true
         WHERE d.raised_by = $2 AND (d.raised_at AT TIME ZONE tn.timezone)::date >= $3
         UNION ALL
         SELECT t.id, 'handover', t.status, t.cash_declared::text, NULL, NULL, t.submit_note, t.id, t.number, t.status,
                false, NULL, t.review_note,
                CASE WHEN t.status = 'reconciled' THEN rc.notes ELSE t.review_note END,
                COALESCE(t.completed_at, t.updated_at), rc.reconciled_at, 0
         FROM fulfilment.trip t CROSS JOIN tn
         LEFT JOIN fulfilment.trip_reconciliation rc ON rc.trip_id = t.id
         WHERE t.driver_employee_id = $1
           AND (t.status IN ('completed', 'on_hold', 'reconciled') OR (t.status = 'in_progress' AND t.review_note IS NOT NULL))
           AND ${TRIP_DAY} >= $3
       ) x
       ORDER BY at DESC
       LIMIT 300`,
      [employeeId, userId, since],
    );
    return r.rows;
  }

  /** When the owner closed the trip, and who. */
  async closedWithClient(client: PoolClient, tripId: string): Promise<{ at: Date; by: string | null } | null> {
    const r = await client.query<{ at: Date; by: string | null }>(
      `SELECT rc.reconciled_at AS at, ${NAME_OF('rc.reconciled_by')} AS by FROM fulfilment.trip_reconciliation rc WHERE rc.trip_id = $1`,
      [tripId],
    );
    return r.rows[0] ?? null;
  }

  /** Who to call at the business: its active owners with a phone. */
  async ownersWithClient(client: PoolClient): Promise<{ name: string; phone: string }[]> {
    const r = await client.query<{ name: string; phone: string }>(
      `SELECT ${NAME_OF('u.id')} AS name, u.phone
       FROM identity.app_user u
       WHERE u.status = 'active' AND u.phone IS NOT NULL
         AND EXISTS (SELECT 1 FROM identity.user_role ur JOIN identity.role r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = 'Owner')
       ORDER BY u.created_at
       LIMIT 3`,
    );
    return r.rows;
  }

  /** The vehicle on the driver's trip today, else on their latest trip. */
  async currentVehicleWithClient(client: PoolClient, employeeId: string, today: string): Promise<{ id: string; registrationNumber: string } | null> {
    const r = await client.query<{ id: string; registration_number: string }>(
      `SELECT v.id, v.registration_number
       FROM fulfilment.trip t JOIN trading_partners.vehicle v ON v.id = t.vehicle_id
       WHERE t.driver_employee_id = $1 AND t.status <> 'cancelled'
       ORDER BY (t.status = 'in_progress') DESC, (t.planned_date = $2::date) DESC, t.started_at DESC NULLS LAST, t.created_at DESC
       LIMIT 1`,
      [employeeId, today],
    );
    return r.rows[0] ? { id: r.rows[0].id, registrationNumber: r.rows[0].registration_number } : null;
  }

  async vehicleWithClient(client: PoolClient, vehicleId: string): Promise<{ id: string; registrationNumber: string; makeModel: string | null } | null> {
    const r = await client.query<{ id: string; registration_number: string; make_model: string | null }>(
      `SELECT v.id, v.registration_number, p.make_model
       FROM trading_partners.vehicle v LEFT JOIN fleet.vehicle_profile p ON p.vehicle_id = v.id WHERE v.id = $1`,
      [vehicleId],
    );
    const v = r.rows[0];
    return v ? { id: v.id, registrationNumber: v.registration_number, makeModel: v.make_model } : null;
  }

  async businessNameWithClient(client: PoolClient): Promise<string> {
    const r = await client.query<{ name: string }>('SELECT name FROM tenant.tenant WHERE id = current_tenant_id()');
    return r.rows[0]?.name ?? '';
  }

  /** The driver's trips on days in a range that set off and aren't closed yet: their incentives are an estimate. */
  async openTripsWithClient(client: PoolClient, employeeId: string, from: string, to: string): Promise<string[]> {
    const r = await client.query<{ id: string }>(
      `WITH ${TZ}
       SELECT t.id FROM fulfilment.trip t CROSS JOIN tn
       WHERE t.driver_employee_id = $1 AND t.status IN ('in_progress', 'completed', 'on_hold') AND ${TRIP_DAY} BETWEEN $2 AND $3
       ORDER BY t.created_at`,
      [employeeId, from, to],
    );
    return r.rows.map((x) => x.id);
  }

  /** The driver's worker record: phone and joining date. */
  async workerWithClient(client: PoolClient, employeeId: string): Promise<{ name: string; phone: string | null; joined_on: string | null } | null> {
    const r = await client.query<{ name: string; phone: string | null; joined_on: string | null }>(
      `SELECT e.name, COALESCE(wp.phone, u.phone) AS phone, wp.joined_on::text AS joined_on
       FROM trading_partners.employee e
       LEFT JOIN workforce.worker_profile wp ON wp.employee_id = e.id
       LEFT JOIN identity.app_user u ON u.id = e.user_id
       WHERE e.id = $1`,
      [employeeId],
    );
    return r.rows[0] ?? null;
  }
}
