import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ExpenseCategory, ExpensePaidBy, FuelType, TripExpensePhotoRecord, TripExpenseRecord } from '../entities/trip-expense.entity';

export interface TripExpenseRow {
  id: string;
  trip_id: string;
  category: ExpenseCategory;
  amount: string;
  notes: string | null;
  recorded_by: string;
  recorded_at: Date;
  client_ref: string | null;
  needs_approval: boolean;
  decision: 'approved' | 'rejected' | null;
  decision_note: string | null;
  decided_at: Date | null;
  odometer_km: number | null;
  fuel_type: FuelType | null;
  full_tank: boolean | null;
  litres: string | null;
  rate_per_litre: string | null;
  paid_by: ExpensePaidBy;
  photos: number;
}

export function toExpenseRecord(row: TripExpenseRow): TripExpenseRecord {
  const hasFuel = row.category === 'fuel' && (row.litres !== null || row.odometer_km !== null);
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    amount: row.amount,
    notes: row.notes,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    clientRef: row.client_ref,
    needsApproval: row.needs_approval,
    decision: row.decision ?? null,
    decisionNote: row.decision_note ?? null,
    decidedAt: row.decided_at ?? null,
    fuel: hasFuel
      ? { odometerKm: row.odometer_km, fuelType: row.fuel_type, fullTank: row.full_tank, litres: row.litres, ratePerLitre: row.rate_per_litre }
      : null,
    photos: row.photos ?? 0,
    paidBy: row.paid_by ?? 'cash',
  };
}

/** Every expense column, and its bill photos counted. */
export const EXPENSE_SELECT = `SELECT e.*, (SELECT count(*)::int FROM fulfilment.trip_expense_photo p WHERE p.expense_id = e.id) AS photos
                FROM fulfilment.trip_expense e`;

export interface NewTripExpense {
  id?: string | null;
  tripId: string;
  category: ExpenseCategory;
  amount: number;
  notes: string | null;
  clientRef: string | null;
  needsApproval?: boolean;
  odometerKm?: number | null;
  fuelType?: FuelType | null;
  fullTank?: boolean | null;
  litres?: number | null;
  ratePerLitre?: number | null;
  paidBy?: ExpensePaidBy;
}

@Injectable()
export class TripExpensesRepository {
  async listByTripWithClient(client: PoolClient, tripId: string): Promise<TripExpenseRecord[]> {
    const result = await client.query<TripExpenseRow>(`${EXPENSE_SELECT} WHERE e.trip_id = $1 ORDER BY e.recorded_at`, [tripId]);
    return result.rows.map(toExpenseRecord);
  }

  async createWithClient(client: PoolClient, recordedBy: string, fields: NewTripExpense): Promise<TripExpenseRecord> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO fulfilment.trip_expense
         (id, trip_id, category, amount, notes, recorded_by, client_ref, needs_approval, odometer_km, fuel_type, full_tank, litres, rate_per_litre, paid_by)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        fields.id ?? null,
        fields.tripId,
        fields.category,
        fields.amount,
        fields.notes,
        recordedBy,
        fields.clientRef,
        fields.needsApproval ?? false,
        fields.odometerKm ?? null,
        fields.fuelType ?? null,
        fields.fullTank ?? null,
        fields.litres ?? null,
        fields.ratePerLitre ?? null,
        fields.paidBy ?? 'cash',
      ],
    );
    return (await this.findByIdWithClient(client, result.rows[0].id)) as TripExpenseRecord;
  }

  /** A retried request's earlier result, if that key was already used on this trip. */
  async findByClientRefWithClient(client: PoolClient, tripId: string, clientRef: string): Promise<TripExpenseRecord | null> {
    const result = await client.query<TripExpenseRow>(`${EXPENSE_SELECT} WHERE e.trip_id = $1 AND e.client_ref = $2`, [tripId, clientRef]);
    return result.rows[0] ? toExpenseRecord(result.rows[0]) : null;
  }

  async findByIdWithClient(client: PoolClient, id: string): Promise<TripExpenseRecord | null> {
    const result = await client.query<TripExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = $1`, [id]);
    return result.rows[0] ? toExpenseRecord(result.rows[0]) : null;
  }

  /** The owner's decision on an expense waiting for one; null when it isn't waiting (decided already, or never needed it). */
  async decideWithClient(
    client: PoolClient,
    id: string,
    decidedBy: string,
    decision: 'approved' | 'rejected',
    note: string | null,
  ): Promise<TripExpenseRecord | null> {
    const result = await client.query<{ id: string }>(
      `UPDATE fulfilment.trip_expense SET decision = $2, decision_note = $3, decided_by = $4, decided_at = now()
       WHERE id = $1 AND needs_approval AND decision IS NULL
       RETURNING id`,
      [id, decision, note, decidedBy],
    );
    return result.rows[0] ? this.findByIdWithClient(client, id) : null;
  }

  /** What the driver paid in cash on this trip — a toll paid by FASTag never came out of the float. */
  async sumByTripWithClient(client: PoolClient, tripId: string): Promise<number> {
    const result = await client.query<{ total: string }>(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM fulfilment.trip_expense WHERE trip_id = $1 AND paid_by = 'cash'",
      [tripId],
    );
    return Number(result.rows[0].total);
  }

  /** The highest odometer read at a pump on this trip — Return can't read less. */
  async maxOdometerOnTripWithClient(client: PoolClient, tripId: string): Promise<number | null> {
    const result = await client.query<{ km: number | null }>('SELECT max(odometer_km) AS km FROM fulfilment.trip_expense WHERE trip_id = $1', [tripId]);
    return result.rows[0]?.km ?? null;
  }

  async insertPhotoWithClient(
    client: PoolClient,
    tenantId: string,
    uploadedBy: string,
    fields: { expenseId: string; storageKey: string; contentType: string; sizeBytes: number },
  ): Promise<TripExpensePhotoRecord> {
    const result = await client.query(
      `INSERT INTO fulfilment.trip_expense_photo (tenant_id, expense_id, storage_key, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, fields.expenseId, fields.storageKey, fields.contentType, fields.sizeBytes, uploadedBy],
    );
    const r = result.rows[0];
    return {
      id: r.id,
      expenseId: r.expense_id,
      storageKey: r.storage_key,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
      uploadedBy: r.uploaded_by,
      uploadedAt: r.uploaded_at,
    };
  }
}
