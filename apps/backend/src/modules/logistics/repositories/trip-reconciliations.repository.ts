import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TripReconciliationRecord } from '../entities/trip-reconciliation.entity';

interface TripReconciliationRow {
  id: string;
  trip_id: string;
  advance_amount: string;
  total_expenses: string;
  cash_returned: string;
  spot_cash: string;
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
    spotCash: row.spot_cash,
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
  /**
   * Cash the driver took for completed spot sales on this trip, and how many
   * of the trip's spot sales still await an approval decision.
   */
  async spotSalesWithClient(client: PoolClient, tripId: string): Promise<{ cash: string; pending: number }> {
    const result = await client.query<{ cash: string; pending: number }>(
      `SELECT COALESCE(SUM(total) FILTER (WHERE status = 'completed' AND payment_method = 'cash'), 0)::numeric(12,2)::text AS cash,
              count(*) FILTER (WHERE status = 'pending_approval')::int AS pending
       FROM spot.spot_sale WHERE trip_id = $1`,
      [tripId],
    );
    return result.rows[0];
  }

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
      spotCash: string;
      variance: number;
      notes: string | null;
    },
  ): Promise<TripReconciliationRecord> {
    try {
      const result = await client.query<TripReconciliationRow>(
        `INSERT INTO fulfilment.trip_reconciliation
           (trip_id, advance_amount, total_expenses, cash_returned, variance, notes, reconciled_by, spot_cash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          fields.tripId,
          fields.advanceAmount,
          fields.totalExpenses,
          fields.cashReturned,
          fields.variance,
          fields.notes,
          reconciledBy,
          fields.spotCash,
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
