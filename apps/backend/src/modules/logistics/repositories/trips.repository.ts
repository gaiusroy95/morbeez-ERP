import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { OptimisticLockException } from '../../../common/persistence/optimistic-lock.exception';
import { clampPageSize, PaginatedResult } from '../../../common/persistence/pagination';
import { TripRecord, TripStatus } from '../entities/trip.entity';
import { dateOnly } from '../../../common/persistence/date-only';

interface TripRow {
  id: string;
  tenant_id: string;
  number: string;
  route_id: string | null;
  vehicle_id: string;
  driver_employee_id: string;
  packer_employee_id: string | null;
  loader_employee_id: string | null;
  status: TripStatus;
  planned_date: string | Date | null;
  advance_amount: string;
  started_at: Date | null;
  opening_km: string | null;
  start_latitude: string | null;
  start_longitude: string | null;
  delivery_started_at: Date | null;
  closing_km: string | null;
  returned_at: Date | null;
  completed_at: Date | null;
  submitted_by: string | null;
  cash_declared: string | null;
  submit_note: string | null;
  review_note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

function toRecord(row: TripRow): TripRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    number: row.number,
    routeId: row.route_id ?? null,
    vehicleId: row.vehicle_id,
    driverEmployeeId: row.driver_employee_id,
    packerEmployeeId: row.packer_employee_id ?? null,
    loaderEmployeeId: row.loader_employee_id ?? null,
    status: row.status,
    plannedDate: dateOnly(row.planned_date),
    advanceAmount: row.advance_amount,
    startedAt: row.started_at,
    openingKm: row.opening_km ?? null,
    startLatitude: row.start_latitude ?? null,
    startLongitude: row.start_longitude ?? null,
    deliveryStartedAt: row.delivery_started_at ?? null,
    closingKm: row.closing_km ?? null,
    returnedAt: row.returned_at ?? null,
    completedAt: row.completed_at,
    submittedBy: row.submitted_by ?? null,
    cashDeclared: row.cash_declared ?? null,
    submitNote: row.submit_note ?? null,
    reviewNote: row.review_note ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

@Injectable()
export class TripsRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    status: TripStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<TripRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<TripRow>(
          `SELECT * FROM fulfilment.trip
           WHERE ($3::text IS NULL OR status = $3)
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [size, offset, status ?? null],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) FROM fulfilment.trip WHERE ($1::text IS NULL OR status = $1)`,
          [status ?? null],
        ),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  async listForDriver(
    tenantId: string,
    driverEmployeeId: string,
    status: TripStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<TripRecord>> {
    const size = clampPageSize(pageSize);
    const offset = (Math.max(page, 1) - 1) * size;

    return this.db.withTenant(tenantId, async (client) => {
      const [rows, count] = await Promise.all([
        client.query<TripRow>(
          `SELECT * FROM fulfilment.trip
           WHERE driver_employee_id = $3 AND ($4::text IS NULL OR status = $4)
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [size, offset, driverEmployeeId, status ?? null],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) FROM fulfilment.trip WHERE driver_employee_id = $1 AND ($2::text IS NULL OR status = $2)`,
          [driverEmployeeId, status ?? null],
        ),
      ]);
      return {
        items: rows.rows.map(toRecord),
        total: Number(count.rows[0].count),
        page: Math.max(page, 1),
        pageSize: size,
      };
    });
  }

  findById(tenantId: string, id: string): Promise<TripRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByIdWithClient(client, id));
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<TripRecord | null> {
    const result = await client.query<TripRow>('SELECT * FROM fulfilment.trip WHERE id = $1', [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    createdBy: string,
    fields: {
      number: string;
      routeId?: string | null;
      vehicleId: string;
      driverEmployeeId: string;
      packerEmployeeId?: string | null;
      loaderEmployeeId?: string | null;
      plannedDate: string | null;
      advanceAmount: number;
    },
  ): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `INSERT INTO fulfilment.trip
         (tenant_id, vehicle_id, driver_employee_id, planned_date, advance_amount, created_by, number, route_id, packer_employee_id, loader_employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        fields.vehicleId,
        fields.driverEmployeeId,
        fields.plannedDate,
        fields.advanceAmount,
        createdBy,
        fields.number,
        fields.routeId ?? null,
        fields.packerEmployeeId ?? null,
        fields.loaderEmployeeId ?? null,
      ],
    );
    return toRecord(result.rows[0]);
  }

  /** [readings]: the odometer and the phone's position when the day started, when the driver gave them. */
  /** Return (driver app D4): the closing KM, correctable while on the road; when it came back is kept from the first time. */
  async returnWithClient(client: PoolClient, id: string, closingKm: number): Promise<TripRecord | null> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET closing_km = $2, returned_at = COALESCE(returned_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING *`,
      [id, closingKm],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** Start Trip (driver app D3): the delivery run set off — the first time only. */
  async startDeliveriesWithClient(client: PoolClient, id: string): Promise<TripRecord | null> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET delivery_started_at = COALESCE(delivery_started_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async startWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    readings: { openingKm: number | null; latitude: number | null; longitude: number | null; accuracyMeters: number | null } = {
      openingKm: null,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
    },
  ): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET
         status = 'in_progress',
         started_at = now(),
         opening_km = $3,
         start_latitude = $4,
         start_longitude = $5,
         start_accuracy_m = $6,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'planned'
       RETURNING *`,
      [id, expectedVersion, readings.openingKm, readings.latitude, readings.longitude, readings.latitude === null ? null : readings.accuracyMeters],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Trip', id);
    return toRecord(result.rows[0]);
  }

  /**
   * A planned trip handed to another driver (owner day-off, backup driver).
   * If they were its packer or loader, they're the driver now instead.
   */
  async assignDriverWithClient(client: PoolClient, id: string, driverEmployeeId: string): Promise<TripRecord | null> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET driver_employee_id = $2,
         packer_employee_id = NULLIF(packer_employee_id, $2), loader_employee_id = NULLIF(loader_employee_id, $2),
         version = version + 1, updated_at = now()
       WHERE id = $1 AND status = 'planned'
       RETURNING *`,
      [id, driverEmployeeId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /** The driver submits the trip for the owner's reconciliation, saying how much cash they're handing over. */
  async completeWithClient(
    client: PoolClient,
    id: string,
    expectedVersion: number,
    submission: { submittedBy: string; cashDeclared: number | null; note: string | null } = { submittedBy: '', cashDeclared: null, note: null },
  ): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET
         status = 'completed',
         completed_at = now(),
         submitted_by = NULLIF($3, '')::uuid,
         cash_declared = $4,
         submit_note = $5,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'in_progress'
       RETURNING *`,
      [id, expectedVersion, submission.submittedBy, submission.cashDeclared, submission.note],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Trip', id);
    return toRecord(result.rows[0]);
  }

  async cancelWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET status = 'cancelled', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status IN ('planned', 'in_progress')
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Trip', id);
    return toRecord(result.rows[0]);
  }

  /** The owner puts a submitted trip on hold, with the reason. */
  async holdWithClient(client: PoolClient, id: string, expectedVersion: number, reason: string): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET status = 'on_hold', review_note = $3, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'completed'
       RETURNING *`,
      [id, expectedVersion, reason],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Trip', id);
    return toRecord(result.rows[0]);
  }

  /**
   * The owner sends a submitted (or held) trip back to the driver to fix:
   * it's on the road again, its submission cleared, with the note saying why.
   */
  async returnToDriverWithClient(client: PoolClient, id: string, expectedVersion: number, note: string): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET
         status = 'in_progress', completed_at = NULL, submitted_by = NULL, cash_declared = NULL, submit_note = NULL,
         review_note = $3, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status IN ('completed', 'on_hold')
       RETURNING *`,
      [id, expectedVersion, note],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Trip', id);
    return toRecord(result.rows[0]);
  }

  async markReconciledWithClient(client: PoolClient, id: string, expectedVersion: number): Promise<TripRecord> {
    const result = await client.query<TripRow>(
      `UPDATE fulfilment.trip SET status = 'reconciled', version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND status IN ('completed', 'on_hold')
       RETURNING *`,
      [id, expectedVersion],
    );
    if (result.rowCount === 0) throw new OptimisticLockException('Trip', id);
    return toRecord(result.rows[0]);
  }
}
