import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CollectionMethod, CustomerCollectionRecord } from '../entities/customer-collection.entity';

interface CustomerCollectionRow {
  id: string;
  tenant_id: string;
  trip_stop_id: string;
  order_id: string;
  amount: string;
  method: CollectionMethod;
  notes: string | null;
  collected_by: string;
  collected_at: Date;
  into_driver_float: boolean;
  client_ref: string | null;
}

function toRecord(row: CustomerCollectionRow): CustomerCollectionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tripStopId: row.trip_stop_id,
    orderId: row.order_id,
    amount: row.amount,
    method: row.method,
    notes: row.notes,
    collectedBy: row.collected_by,
    collectedAt: row.collected_at,
    intoDriverFloat: row.into_driver_float,
    clientRef: row.client_ref,
  };
}

@Injectable()
export class CustomerCollectionsRepository {
  async listByStopWithClient(client: PoolClient, tripStopId: string): Promise<CustomerCollectionRecord[]> {
    const result = await client.query<CustomerCollectionRow>(
      'SELECT * FROM money.customer_collection WHERE trip_stop_id = $1 ORDER BY collected_at',
      [tripStopId],
    );
    return result.rows.map(toRecord);
  }

  async createWithClient(
    client: PoolClient,
    tenantId: string,
    collectedBy: string,
    fields: {
      tripStopId: string;
      orderId: string;
      amount: number;
      method: CollectionMethod;
      notes: string | null;
      clientRef: string | null;
      intoDriverFloat: boolean;
    },
  ): Promise<CustomerCollectionRecord> {
    const result = await client.query<CustomerCollectionRow>(
      `INSERT INTO money.customer_collection (tenant_id, trip_stop_id, order_id, amount, method, notes, collected_by, client_ref, into_driver_float)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [tenantId, fields.tripStopId, fields.orderId, fields.amount, fields.method, fields.notes, collectedBy, fields.clientRef, fields.intoDriverFloat],
    );
    return toRecord(result.rows[0]);
  }

  /** A retried request's earlier result, if that key was already used at this stop. */
  async findByClientRefWithClient(client: PoolClient, tripStopId: string, clientRef: string): Promise<CustomerCollectionRecord | null> {
    const result = await client.query<CustomerCollectionRow>(
      'SELECT * FROM money.customer_collection WHERE trip_stop_id = $1 AND client_ref = $2',
      [tripStopId, clientRef],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}
