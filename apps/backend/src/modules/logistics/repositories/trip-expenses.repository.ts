import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ExpenseCategory, TripExpenseRecord } from '../entities/trip-expense.entity';

interface TripExpenseRow {
  id: string;
  trip_id: string;
  category: ExpenseCategory;
  amount: string;
  notes: string | null;
  recorded_by: string;
  recorded_at: Date;
  client_ref: string | null;
}

function toRecord(row: TripExpenseRow): TripExpenseRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    amount: row.amount,
    notes: row.notes,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    clientRef: row.client_ref,
  };
}

@Injectable()
export class TripExpensesRepository {
  async listByTripWithClient(client: PoolClient, tripId: string): Promise<TripExpenseRecord[]> {
    const result = await client.query<TripExpenseRow>(
      'SELECT * FROM fulfilment.trip_expense WHERE trip_id = $1 ORDER BY recorded_at',
      [tripId],
    );
    return result.rows.map(toRecord);
  }

  async createWithClient(
    client: PoolClient,
    recordedBy: string,
    fields: { tripId: string; category: ExpenseCategory; amount: number; notes: string | null; clientRef: string | null },
  ): Promise<TripExpenseRecord> {
    const result = await client.query<TripExpenseRow>(
      `INSERT INTO fulfilment.trip_expense (trip_id, category, amount, notes, recorded_by, client_ref)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [fields.tripId, fields.category, fields.amount, fields.notes, recordedBy, fields.clientRef],
    );
    return toRecord(result.rows[0]);
  }

  /** A retried request's earlier result, if that key was already used on this trip. */
  async findByClientRefWithClient(client: PoolClient, tripId: string, clientRef: string): Promise<TripExpenseRecord | null> {
    const result = await client.query<TripExpenseRow>(
      'SELECT * FROM fulfilment.trip_expense WHERE trip_id = $1 AND client_ref = $2',
      [tripId, clientRef],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async sumByTripWithClient(client: PoolClient, tripId: string): Promise<number> {
    const result = await client.query<{ total: string }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM fulfilment.trip_expense WHERE trip_id = $1',
      [tripId],
    );
    return Number(result.rows[0].total);
  }
}
