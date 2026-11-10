import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AgentAccount, AgentCommissionRecord, AgentPaymentRecord, PaymentMethod } from '../entities/finance-engine.entity';

interface AccountRow {
  id: string;
  name: string;
  phone: string | null;
  pan: string | null;
  status: 'active' | 'archived';
  earned: string;
  settled: string;
  owed: string;
}

const ACCOUNT_SELECT = `
  SELECT a.id, a.name, a.phone, a.pan, a.status,
         COALESCE(e.earned, 0)::numeric(12,2)::text AS earned,
         COALESCE(s.settled, 0)::numeric(12,2)::text AS settled,
         (COALESCE(e.earned, 0) - COALESCE(s.settled, 0))::numeric(12,2)::text AS owed
    FROM trading_partners.agent a
    LEFT JOIN LATERAL (SELECT SUM(amount) AS earned FROM money.agent_commission c WHERE c.agent_id = a.id) e ON true
    LEFT JOIN LATERAL (SELECT SUM(amount) AS settled FROM money.agent_payment p WHERE p.agent_id = a.id) s ON true`;

const toAccount = (r: AccountRow): AgentAccount => ({
  agentId: r.id,
  name: r.name,
  phone: r.phone,
  pan: r.pan,
  status: r.status,
  earned: r.earned,
  settled: r.settled,
  owed: r.owed,
});

/** The agent payable sub-ledger (AGT.2): commission earned on graded lots, less what's been settled. */
@Injectable()
export class AgentsFinanceRepository {
  async lockAgentWithClient(client: PoolClient, agentId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('finance.agent'), hashtext($1))`, [agentId]);
  }

  async accountsWithClient(client: PoolClient): Promise<AgentAccount[]> {
    const r = await client.query<AccountRow>(`${ACCOUNT_SELECT} ORDER BY a.status, a.name`);
    return r.rows.map(toAccount);
  }

  async accountWithClient(client: PoolClient, agentId: string): Promise<AgentAccount | null> {
    const r = await client.query<AccountRow>(`${ACCOUNT_SELECT} WHERE a.id = $1`, [agentId]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async commissionsWithClient(client: PoolClient, agentId: string): Promise<AgentCommissionRecord[]> {
    const r = await client.query<{
      id: string;
      lot_id: string;
      purchase_order_id: string;
      po_number: number;
      product_name: string;
      accepted_kg: string;
      rate_per_kg: string;
      amount: string;
      accrued_at: Date;
    }>(
      `SELECT c.id, c.lot_id, c.purchase_order_id, po.number AS po_number, p.name AS product_name,
              c.accepted_kg::text AS accepted_kg, c.rate_per_kg::text AS rate_per_kg, c.amount::text AS amount, c.accrued_at
         FROM money.agent_commission c
         JOIN commerce.purchase_order po ON po.id = c.purchase_order_id
         JOIN commerce.lot l ON l.id = c.lot_id
         JOIN trading_partners.product p ON p.id = l.product_id
        WHERE c.agent_id = $1
        ORDER BY c.accrued_at DESC
        LIMIT 200`,
      [agentId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      lotId: x.lot_id,
      purchaseOrderId: x.purchase_order_id,
      purchaseOrderNumber: x.po_number,
      productName: x.product_name,
      acceptedKg: x.accepted_kg,
      ratePerKg: x.rate_per_kg,
      amount: x.amount,
      accruedAt: x.accrued_at,
    }));
  }

  async paymentsWithClient(client: PoolClient, agentId: string): Promise<AgentPaymentRecord[]> {
    const r = await client.query<{
      id: string;
      agent_id: string;
      amount: string;
      tds_section: string | null;
      tds_amount: string;
      net_paid: string;
      method: PaymentMethod;
      reference: string | null;
      paid_at: Date;
    }>(
      `SELECT id, agent_id, amount::text AS amount, tds_section, tds_amount::text AS tds_amount,
              (amount - tds_amount)::numeric(12,2)::text AS net_paid, method, reference, paid_at
         FROM money.agent_payment WHERE agent_id = $1 ORDER BY paid_at DESC LIMIT 200`,
      [agentId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      agentId: x.agent_id,
      amount: x.amount,
      tdsSection: x.tds_section,
      tdsAmount: x.tds_amount,
      netPaid: x.net_paid,
      method: x.method,
      reference: x.reference,
      paidAt: x.paid_at,
    }));
  }

  async findPaymentWithClient(client: PoolClient, id: string): Promise<AgentPaymentRecord | null> {
    const r = await client.query<{ agent_id: string }>('SELECT agent_id FROM money.agent_payment WHERE id = $1', [id]);
    if (!r.rows[0]) return null;
    return (await this.paymentsWithClient(client, r.rows[0].agent_id)).find((p) => p.id === id) ?? null;
  }

  async commissionOfLotWithClient(client: PoolClient, lotId: string): Promise<string | null> {
    const r = await client.query<{ id: string }>('SELECT id FROM money.agent_commission WHERE lot_id = $1', [lotId]);
    return r.rows[0]?.id ?? null;
  }

  async insertCommissionWithClient(
    client: PoolClient,
    c: {
      id: string;
      tenantId: string;
      agentId: string;
      lotId: string;
      purchaseOrderId: string;
      acceptedKg: string;
      ratePerKg: string;
      amount: string;
      accruedAt: Date;
      entryId: string;
      createdBy: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.agent_commission
         (id, tenant_id, agent_id, lot_id, purchase_order_id, accepted_kg, rate_per_kg, amount, accrued_at, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [c.id, c.tenantId, c.agentId, c.lotId, c.purchaseOrderId, c.acceptedKg, c.ratePerKg, c.amount, c.accruedAt, c.entryId, c.createdBy],
    );
  }

  async insertPaymentWithClient(
    client: PoolClient,
    p: {
      id: string;
      tenantId: string;
      agentId: string;
      amount: string;
      tdsSection: string | null;
      tdsAmount: string;
      method: PaymentMethod;
      reference: string | null;
      paidAt: Date;
      entryId: string;
      createdBy: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.agent_payment
         (id, tenant_id, agent_id, amount, tds_section, tds_amount, method, reference, paid_at, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.id, p.tenantId, p.agentId, p.amount, p.tdsSection, p.tdsAmount, p.method, p.reference, p.paidAt, p.entryId, p.createdBy],
    );
  }

  /** The tenant-local calendar date of an instant. */
  async localDateWithClient(client: PoolClient, at: Date): Promise<string> {
    const r = await client.query<{ d: string }>(
      `SELECT ($1::timestamptz AT TIME ZONE timezone)::date::text AS d FROM tenant.tenant WHERE id = current_tenant_id()`,
      [at],
    );
    return r.rows[0].d;
  }
}
