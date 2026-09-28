import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { FinanceCostCategory, FinanceCostLine, FinanceCostRecord } from '../entities/finance-engine.entity';

interface CostRow {
  id: string;
  category: FinanceCostCategory;
  amount: string;
  paid_from: 'bank' | 'cash_on_hand';
  description: string;
  reference: string | null;
  incurred_at: Date;
}

@Injectable()
export class FinanceCostsRepository {
  async insertWithClient(
    client: PoolClient,
    fields: {
      tenantId: string;
      category: FinanceCostCategory;
      amount: string;
      paidFrom: 'bank' | 'cash_on_hand';
      description: string;
      reference: string | null;
      incurredAt: Date;
      recordedBy: string;
    },
  ): Promise<FinanceCostRecord> {
    const result = await client.query<CostRow>(
      `INSERT INTO money.finance_cost (tenant_id, category, amount, paid_from, description, reference, incurred_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, category, amount::text AS amount, paid_from, description, reference, incurred_at`,
      [
        fields.tenantId,
        fields.category,
        fields.amount,
        fields.paidFrom,
        fields.description,
        fields.reference,
        fields.incurredAt,
        fields.recordedBy,
      ],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      amount: row.amount,
      paidFrom: row.paid_from,
      description: row.description,
      reference: row.reference,
      incurredAt: row.incurred_at,
    };
  }

  /**
   * Recorded costs plus the fees carried on payments, in [startAt, endAt).
   * A reversed customer payment's fee still counts — the channel kept it.
   */
  async linesWithClient(client: PoolClient, startAt: Date, endAt: Date): Promise<FinanceCostLine[]> {
    const result = await client.query<{
      source: FinanceCostLine['source'];
      id: string;
      category: FinanceCostCategory;
      amount: string;
      description: string;
      reference: string | null;
      incurred_at: Date;
    }>(
      `SELECT * FROM (
         SELECT 'recorded' AS source, id, category, amount::text AS amount, description, reference, incurred_at
           FROM money.finance_cost WHERE incurred_at >= $1 AND incurred_at < $2
         UNION ALL
         SELECT 'customer_payment_fee', p.id, 'payment_fee', p.fee_amount::text,
                'Fee on payment from ' || c.name || ' (' || p.method || ')', p.reference, p.received_at
           FROM money.customer_payment p JOIN trading_partners.customer c ON c.id = p.customer_id
          WHERE p.fee_amount > 0 AND p.received_at >= $1 AND p.received_at < $2
         UNION ALL
         SELECT 'farmer_payment_fee', p.id, 'payment_fee', p.fee_amount::text,
                'Fee on payment to ' || f.name || ' (' || p.method || ')', p.reference, p.paid_at
           FROM money.farmer_payment p JOIN trading_partners.farmer f ON f.id = p.farmer_id
          WHERE p.fee_amount > 0 AND p.paid_at >= $1 AND p.paid_at < $2
       ) costs
       ORDER BY incurred_at DESC`,
      [startAt, endAt],
    );
    return result.rows.map((r) => ({
      source: r.source,
      id: r.id,
      category: r.category,
      amount: r.amount,
      description: r.description,
      reference: r.reference,
      incurredAt: r.incurred_at,
    }));
  }
}
