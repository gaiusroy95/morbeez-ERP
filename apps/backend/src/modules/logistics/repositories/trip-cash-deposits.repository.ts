import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TripCashDepositRecord } from '../entities/trip-cash-deposit.entity';

interface TripCashDepositRow {
  id: string;
  trip_id: string;
  amount: string;
  bank_account: string;
  reference: string;
  deposited_at: Date;
  recorded_by: string;
  recorded_at: Date;
  client_ref: string | null;
}

function toRecord(row: TripCashDepositRow): TripCashDepositRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    amount: row.amount,
    bankAccount: row.bank_account,
    reference: row.reference,
    depositedAt: row.deposited_at,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    clientRef: row.client_ref,
  };
}

@Injectable()
export class TripCashDepositsRepository {
  async listByTripWithClient(client: PoolClient, tripId: string): Promise<TripCashDepositRecord[]> {
    const result = await client.query<TripCashDepositRow>(
      'SELECT * FROM fulfilment.trip_cash_deposit WHERE trip_id = $1 ORDER BY deposited_at, recorded_at',
      [tripId],
    );
    return result.rows.map(toRecord);
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    recordedBy: string,
    fields: { tripId: string; amount: number; bankAccount: string; reference: string; depositedAt: Date; clientRef: string | null },
  ): Promise<TripCashDepositRecord> {
    const result = await client.query<TripCashDepositRow>(
      `INSERT INTO fulfilment.trip_cash_deposit (tenant_id, trip_id, amount, bank_account, reference, deposited_at, recorded_by, client_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenantId, fields.tripId, fields.amount, fields.bankAccount, fields.reference, fields.depositedAt, recordedBy, fields.clientRef],
    );
    return toRecord(result.rows[0]);
  }

  /** A retried request's earlier result, if that key was already used on this trip. */
  async findByClientRefWithClient(client: PoolClient, tripId: string, clientRef: string): Promise<TripCashDepositRecord | null> {
    const result = await client.query<TripCashDepositRow>(
      'SELECT * FROM fulfilment.trip_cash_deposit WHERE trip_id = $1 AND client_ref = $2',
      [tripId, clientRef],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
