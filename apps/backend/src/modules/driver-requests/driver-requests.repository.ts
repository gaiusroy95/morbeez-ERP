import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DriverRequest, DriverRequestKind, DriverRequestStatus, NewCustomerDetails } from './driver-requests.entity';

interface Row {
  id: string;
  kind: DriverRequestKind;
  status: DriverRequestStatus;
  driver_employee_id: string;
  driver_name: string;
  trip_id: string | null;
  trip_number: string | null;
  amount: string | null;
  customer_id: string | null;
  customer_name: string | null;
  current_limit: string | null;
  details: Record<string, unknown>;
  reason: string;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  decision_note: string | null;
  result_ref: string | null;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toRequest(r: Row): DriverRequest {
  const d = r.details ?? {};
  const newCustomer: NewCustomerDetails | null =
    r.kind === 'new_customer'
      ? {
          name: String(d.name ?? ''),
          phone: text(d.phone),
          place: text(d.place),
          address: text(d.address),
          language: text(d.language),
          latitude: num(d.latitude),
          longitude: num(d.longitude),
        }
      : null;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    driverEmployeeId: r.driver_employee_id,
    driverName: r.driver_name,
    tripId: r.trip_id,
    tripNumber: r.trip_number,
    amount: r.amount,
    customerId: r.customer_id,
    customerName: r.customer_name,
    currentCreditLimit: r.current_limit,
    newCustomer,
    reason: r.reason,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    decisionNote: r.decision_note,
    resultRef: r.result_ref,
  };
}

/** Who decided: their worker name when the login is a worker's, else the login itself. */
const NAME_OF = (user: string) => `
  COALESCE((SELECT e.name FROM trading_partners.employee e WHERE e.user_id = ${user} ORDER BY e.created_at LIMIT 1),
           (SELECT COALESCE(u.phone, u.email) FROM identity.app_user u WHERE u.id = ${user}))`;

const SELECT = `
  SELECT r.id, r.kind, r.status, r.driver_employee_id, d.name AS driver_name, r.trip_id, t.number AS trip_number,
         r.amount::text AS amount, r.customer_id, c.name AS customer_name, c.credit_limit::text AS current_limit,
         r.details, r.reason, r.requested_at, r.decided_at, ${NAME_OF('r.decided_by')} AS decided_by, r.decision_note, r.result_ref
    FROM fulfilment.driver_request r
    JOIN trading_partners.employee d ON d.id = r.driver_employee_id
    LEFT JOIN fulfilment.trip t ON t.id = r.trip_id
    LEFT JOIN trading_partners.customer c ON c.id = r.customer_id`;

export interface NewDriverRequest {
  id: string | null;
  tenantId: string;
  driverEmployeeId: string;
  tripId: string | null;
  kind: DriverRequestKind;
  amount: string | null;
  customerId: string | null;
  details: Record<string, unknown>;
  reason: string;
  requestedBy: string;
}

@Injectable()
export class DriverRequestsRepository {
  async insertWithClient(client: PoolClient, f: NewDriverRequest): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO fulfilment.driver_request (id, tenant_id, driver_employee_id, trip_id, kind, amount, customer_id, details, reason, requested_by)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [f.id, f.tenantId, f.driverEmployeeId, f.tripId, f.kind, f.amount, f.customerId, JSON.stringify(f.details), f.reason, f.requestedBy],
    );
    return r.rows[0].id;
  }

  async findWithClient(client: PoolClient, id: string): Promise<DriverRequest | null> {
    const r = await client.query<Row>(`${SELECT} WHERE r.id = $1`, [id]);
    return r.rows[0] ? toRequest(r.rows[0]) : null;
  }

  /** Held until the decision commits, so two owners can't both approve it. */
  async lockWithClient(client: PoolClient, id: string): Promise<boolean> {
    const r = await client.query('SELECT 1 FROM fulfilment.driver_request WHERE id = $1 FOR UPDATE', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async listWithClient(client: PoolClient, f: { driverEmployeeId?: string; status?: DriverRequestStatus; limit: number }): Promise<DriverRequest[]> {
    const r = await client.query<Row>(
      `${SELECT}
       WHERE ($1::uuid IS NULL OR r.driver_employee_id = $1) AND ($2::text IS NULL OR r.status = $2)
       ORDER BY r.requested_at DESC
       LIMIT $3`,
      [f.driverEmployeeId ?? null, f.status ?? null, f.limit],
    );
    return r.rows.map(toRequest);
  }

  async decideWithClient(
    client: PoolClient,
    id: string,
    d: { status: 'approved' | 'rejected'; decidedBy: string; note: string | null; resultRef: string | null },
  ): Promise<void> {
    await client.query(
      `UPDATE fulfilment.driver_request SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, result_ref = $5
       WHERE id = $1 AND status = 'pending'`,
      [id, d.status, d.decidedBy, d.note, d.resultRef],
    );
  }

  /** The trip, if it's the driver's own. */
  async driversTripWithClient(client: PoolClient, tripId: string, driverEmployeeId: string): Promise<boolean> {
    const r = await client.query('SELECT 1 FROM fulfilment.trip WHERE id = $1 AND driver_employee_id = $2', [tripId, driverEmployeeId]);
    return (r.rowCount ?? 0) > 0;
  }

  async customerWithClient(client: PoolClient, id: string): Promise<{ name: string; status: string; version: number; paymentTermsDays: number } | null> {
    const r = await client.query('SELECT name, status, version, payment_terms_days FROM trading_partners.customer WHERE id = $1', [id]);
    const c = r.rows[0];
    return c ? { name: c.name, status: c.status, version: c.version, paymentTermsDays: c.payment_terms_days } : null;
  }

  async todayWithClient(client: PoolClient): Promise<string> {
    const r = await client.query<{ today: string }>('SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM tenant.tenant WHERE id = current_tenant_id()');
    return r.rows[0].today;
  }
}
