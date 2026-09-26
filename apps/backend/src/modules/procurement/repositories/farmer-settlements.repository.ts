import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../infra/database/database.service';
import { FarmerSettlementRecord, SettlementMethod } from '../entities/farmer-settlement.entity';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

interface FarmerSettlementRow {
  id: string;
  tenant_id: string;
  lot_id: string;
  farmer_id: string;
  amount: string;
  method: SettlementMethod;
  notes: string | null;
  settled_by: string;
  settled_at: Date;
}

function toRecord(row: FarmerSettlementRow): FarmerSettlementRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lotId: row.lot_id,
    farmerId: row.farmer_id,
    amount: row.amount,
    method: row.method,
    notes: row.notes,
    settledBy: row.settled_by,
    settledAt: row.settled_at,
  };
}

@Injectable()
export class FarmerSettlementsRepository {
  constructor(private readonly db: DatabaseService) {}

  findByLotId(tenantId: string, lotId: string): Promise<FarmerSettlementRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.findByLotIdWithClient(client, lotId));
  }

  async findByLotIdWithClient(client: PoolClient, lotId: string): Promise<FarmerSettlementRecord | null> {
    const result = await client.query<FarmerSettlementRow>(
      'SELECT * FROM money.farmer_settlement WHERE lot_id = $1',
      [lotId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  listByPurchaseOrder(tenantId: string, purchaseOrderId: string): Promise<FarmerSettlementRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<FarmerSettlementRow>(
        `SELECT s.* FROM money.farmer_settlement s
         JOIN commerce.lot l ON l.id = s.lot_id
         WHERE l.purchase_order_id = $1
         ORDER BY s.settled_at`,
        [purchaseOrderId],
      );
      return result.rows.map(toRecord);
    });
  }

  // money.farmer_settlement_one_per_lot (a UNIQUE constraint on lot_id) is
  // the real enforcement against double-paying a lot; this just translates
  // the resulting unique_violation into something the API can return.
  async createWithClient(
    client: PoolClient,
    tenantId: string,
    settledBy: string,
    fields: {
      lotId: string;
      farmerId: string;
      amount: number;
      method: SettlementMethod;
      notes?: string | null;
    },
  ): Promise<FarmerSettlementRecord> {
    try {
      const result = await client.query<FarmerSettlementRow>(
        `INSERT INTO money.farmer_settlement (tenant_id, lot_id, farmer_id, amount, method, notes, settled_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenantId, fields.lotId, fields.farmerId, fields.amount, fields.method, fields.notes ?? null, settledBy],
      );
      return toRecord(result.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This lot has already been settled');
      }
      throw err;
    }
  }
}
