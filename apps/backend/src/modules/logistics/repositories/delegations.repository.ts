import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DelegationKind, DelegationLevel, DelegationRecord } from '../delegation';

interface DelegationRow {
  id: string;
  driver_employee_id: string;
  level: number;
  kind: DelegationKind;
  trip_id: string | null;
  ends_at: Date | null;
  note: string | null;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

function toRecord(row: DelegationRow): DelegationRecord {
  return {
    id: row.id,
    driverEmployeeId: row.driver_employee_id,
    level: row.level as DelegationLevel,
    kind: row.kind,
    tripId: row.trip_id,
    endsAt: row.ends_at,
    note: row.note,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

/** A driver as the owner sees them when choosing who runs a trip. */
export interface DriverPoolRow {
  employeeId: string;
  name: string;
  hasLogin: boolean;
  isMe: boolean;
  delegationLevel: number | null;
  standingDelegation: boolean;
  /** On the road right now (a trip in progress). */
  busy: boolean;
  /** Reliability over the last 90 days (requirement: delegation score). */
  tripsClosed: number;
  closedClean: number;
  cashMismatches: number;
  lastTripAt: Date | null;
}

@Injectable()
export class DelegationsRepository {
  async createWithClient(
    client: PoolClient,
    tenantId: string,
    grantedBy: string,
    fields: { driverEmployeeId: string; level: number; kind: DelegationKind; tripId: string | null; endsAt: Date | null; note: string | null },
  ): Promise<DelegationRecord> {
    const result = await client.query<DelegationRow>(
      `INSERT INTO fulfilment.delegation (tenant_id, driver_employee_id, level, kind, trip_id, ends_at, note, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenantId, fields.driverEmployeeId, fields.level, fields.kind, fields.tripId, fields.endsAt, fields.note, grantedBy],
    );
    return toRecord(result.rows[0]);
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<DelegationRecord | null> {
    const result = await client.query<DelegationRow>('SELECT * FROM fulfilment.delegation WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async revokeWithClient(client: PoolClient, id: string, revokedBy: string): Promise<DelegationRecord | null> {
    const result = await client.query<DelegationRow>(
      `UPDATE fulfilment.delegation SET revoked_at = now(), revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING *`,
      [id, revokedBy],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** Ends every day-off grant still running — the owner is back. */
  async revokeDayOffWithClient(client: PoolClient, revokedBy: string): Promise<number> {
    const result = await client.query(
      `UPDATE fulfilment.delegation SET revoked_at = now(), revoked_by = $1
        WHERE kind = 'day_off' AND revoked_at IS NULL AND ends_at > now()`,
      [revokedBy],
    );
    return result.rowCount ?? 0;
  }

  /** Grants that could still apply to this driver (not revoked; expiry is judged by authorityOf). */
  async listOpenForDriverWithClient(client: PoolClient, driverEmployeeId: string): Promise<DelegationRecord[]> {
    const result = await client.query<DelegationRow>(
      `SELECT * FROM fulfilment.delegation
        WHERE driver_employee_id = $1 AND revoked_at IS NULL
          AND (ends_at IS NULL OR ends_at > now())
        ORDER BY granted_at`,
      [driverEmployeeId],
    );
    return result.rows.map(toRecord);
  }

  /** Recent grants, newest first: what the owner has handed over lately. */
  async listRecentWithClient(client: PoolClient, limit: number): Promise<(DelegationRecord & { driverName: string; tripStatus: string | null })[]> {
    const result = await client.query<DelegationRow & { driver_name: string; trip_status: string | null }>(
      `SELECT d.*, e.name AS driver_name, t.status AS trip_status
         FROM fulfilment.delegation d
         JOIN trading_partners.employee e ON e.id = d.driver_employee_id
         LEFT JOIN fulfilment.trip t ON t.id = d.trip_id
        ORDER BY d.granted_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((r) => ({ ...toRecord(r), driverName: r.driver_name, tripStatus: r.trip_status }));
  }

  async driverPoolWithClient(client: PoolClient, actorUserId: string): Promise<DriverPoolRow[]> {
    const result = await client.query<{
      id: string;
      name: string;
      user_id: string | null;
      delegation_level: number | null;
      standing_delegation: boolean;
      busy: boolean;
      trips_closed: string;
      closed_clean: string;
      cash_mismatches: string;
      last_trip_at: Date | null;
    }>(
      `SELECT e.id, e.name, e.user_id, e.delegation_level, e.standing_delegation,
              EXISTS (SELECT 1 FROM fulfilment.trip t WHERE t.driver_employee_id = e.id AND t.status = 'in_progress') AS busy,
              count(r.id) AS trips_closed,
              count(r.id) FILTER (WHERE r.outcome = 'pass') AS closed_clean,
              count(r.id) FILTER (WHERE r.variance <> 0) AS cash_mismatches,
              max(r.reconciled_at) AS last_trip_at
         FROM trading_partners.employee e
         LEFT JOIN fulfilment.trip t2 ON t2.driver_employee_id = e.id
         LEFT JOIN fulfilment.trip_reconciliation r ON r.trip_id = t2.id AND r.reconciled_at > now() - interval '90 days'
        WHERE e.role_type = 'driver' AND e.status = 'active'
        GROUP BY e.id
        ORDER BY e.name`,
    );
    return result.rows.map((r) => ({
      employeeId: r.id,
      name: r.name,
      hasLogin: r.user_id !== null,
      isMe: r.user_id === actorUserId,
      delegationLevel: r.delegation_level,
      standingDelegation: r.standing_delegation,
      busy: r.busy,
      tripsClosed: Number(r.trips_closed),
      closedClean: Number(r.closed_clean),
      cashMismatches: Number(r.cash_mismatches),
      lastTripAt: r.last_trip_at,
    }));
  }
}
