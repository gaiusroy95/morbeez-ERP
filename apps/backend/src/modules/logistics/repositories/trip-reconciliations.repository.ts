import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TripReconciliationRecord } from '../entities/trip-reconciliation.entity';

interface TripReconciliationRow {
  id: string;
  trip_id: string;
  advance_amount: string;
  total_expenses: string;
  cash_returned: string;
  variance: string;
  notes: string | null;
  reconciled_by: string;
  reconciled_at: Date;
}

function toRecord(row: TripReconciliationRow): TripReconciliationRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    advanceAmount: row.advance_amount,
    totalExpenses: row.total_expenses,
    cashReturned: row.cash_returned,
    variance: row.variance,
    notes: row.notes,
    reconciledBy: row.reconciled_by,
    reconciledAt: row.reconciled_at,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

@Injectable()
export class TripReconciliationsRepository {
  async findByTripWithClient(client: PoolClient, tripId: string): Promise<TripReconciliationRecord | null> {
    const result = await client.query<TripReconciliationRow>(
      'SELECT * FROM fulfilment.trip_reconciliation WHERE trip_id = $1',
      [tripId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async createWithClient(
    client: PoolClient,
    reconciledBy: string,
    fields: {
      tripId: string;
      advanceAmount: number;
      totalExpenses: number;
      cashReturned: number;
      variance: number;
      notes: string | null;
    },
  ): Promise<TripReconciliationRecord> {
    try {
      const result = await client.query<TripReconciliationRow>(
        `INSERT INTO fulfilment.trip_reconciliation
           (trip_id, advance_amount, total_expenses, cash_returned, variance, notes, reconciled_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          fields.tripId,
          fields.advanceAmount,
          fields.totalExpenses,
          fields.cashReturned,
          fields.variance,
          fields.notes,
          reconciledBy,
        ],
      );
      return toRecord(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This trip has already been reconciled');
      }
      throw err;
    }
  }
}
