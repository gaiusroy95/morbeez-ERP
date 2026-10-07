import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { compareMoney, moneyFromNumber, subtractMoney } from '../../common/money';

export type DisputeStatus = 'open' | 'resolved' | 'withdrawn';

export interface DisputeNote {
  at: string;
  by: string;
  text: string;
}

export interface InvoiceDispute {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: string;
  reason: string;
  status: DisputeStatus;
  notes: DisputeNote[];
  raisedBy: string;
  raisedAt: Date;
  lastActivityAt: Date;
  /** Days since anyone last touched it; 30 makes it a critical exception. */
  idleDays: number;
  resolvedAt: Date | null;
  resolution: string | null;
  version: number;
}

/** A dispute nobody has touched for this long is a critical exception for the owner (client Q&A, finance). */
export const DISPUTE_STALE_DAYS = 30;

const DISPUTE_ENTITY = 'invoice_dispute';

const SELECT = `
  SELECT d.*, i.invoice_number, c.name AS customer_name,
         floor(extract(epoch FROM now() - d.last_activity_at) / 86400)::int AS idle_days
    FROM money.invoice_dispute d
    JOIN money.invoice i ON i.id = d.invoice_id
    JOIN trading_partners.customer c ON c.id = d.customer_id`;

interface DisputeRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  amount: string;
  reason: string;
  status: DisputeStatus;
  notes: DisputeNote[];
  raised_by: string;
  raised_at: Date;
  last_activity_at: Date;
  idle_days: number;
  resolved_at: Date | null;
  resolution: string | null;
  version: number;
}

const toDispute = (r: DisputeRow): InvoiceDispute => ({
  id: r.id,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  customerId: r.customer_id,
  customerName: r.customer_name,
  amount: r.amount,
  reason: r.reason,
  status: r.status,
  notes: r.notes ?? [],
  raisedBy: r.raised_by,
  raisedAt: r.raised_at,
  lastActivityAt: r.last_activity_at,
  idleDays: r.idle_days,
  resolvedAt: r.resolved_at,
  resolution: r.resolution,
  version: r.version,
});

/**
 * Invoice disputes (client Q&A, finance). A customer disputes part or all of
 * an invoice; while it's open, finance charges pause on the disputed amount
 * only (ReceivablesService.runFinanceCharges). Left untouched for 30 days it
 * becomes a critical exception for the owner. Closing a dispute records the
 * outcome and nothing else — no automatic write-off or reversal: if money
 * should move, the owner does that deliberately.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, filter: { status?: DisputeStatus; customerId?: string; invoiceId?: string }): Promise<InvoiceDispute[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query<DisputeRow>(
        `${SELECT}
          WHERE ($1::text IS NULL OR d.status = $1) AND ($2::uuid IS NULL OR d.customer_id = $2) AND ($3::uuid IS NULL OR d.invoice_id = $3)
          ORDER BY (d.status = 'open') DESC, d.last_activity_at
          LIMIT 200`,
        [filter.status ?? null, filter.customerId ?? null, filter.invoiceId ?? null],
      );
      return result.rows.map(toDispute);
    });
  }

  async raise(tenantId: string, actorUserId: string, dto: { invoiceId: string; amount: number; reason: string }): Promise<InvoiceDispute> {
    return this.db.withTenant(tenantId, async (client) => {
      // Two disputes raised at once can't between them exceed what's owed.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dispute:${dto.invoiceId}`]);
      const invoice = (
        await client.query<{ id: string; customer_id: string; outstanding: string }>(
          'SELECT invoice_id AS id, customer_id, outstanding::text AS outstanding FROM money.invoice_balance WHERE invoice_id = $1',
          [dto.invoiceId],
        )
      ).rows[0];
      if (!invoice) throw new NotFoundException('Invoice not found');
      const already = (
        await client.query<{ disputed: string }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric(12,2)::text AS disputed FROM money.invoice_dispute WHERE invoice_id = $1 AND status = 'open'`,
          [dto.invoiceId],
        )
      ).rows[0].disputed;
      const room = subtractMoney(invoice.outstanding, already);
      const amount = moneyFromNumber(dto.amount);
      if (compareMoney(amount, room) > 0) {
        throw new BadRequestException(`Only ₹${room} of this invoice is outstanding and not already disputed`);
      }
      const id = (
        await client.query<{ id: string }>(
          `INSERT INTO money.invoice_dispute (tenant_id, invoice_id, customer_id, amount, reason, raised_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, dto.invoiceId, invoice.customer_id, amount, dto.reason.trim(), actorUserId],
        )
      ).rows[0].id;
      const dispute = await this.findWithClient(client, id);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: DISPUTE_ENTITY,
        entityId: id,
        after: dispute as unknown as Record<string, unknown>,
      });
      return dispute;
    });
  }

  /** Anything said or done about it: a note, which also restarts the 30-day clock. */
  addNote(tenantId: string, actorUserId: string, id: string, note: string): Promise<InvoiceDispute> {
    return this.change(tenantId, actorUserId, id, async (client, before) => {
      if (before.status !== 'open') throw new ConflictException('This dispute is closed');
      await client.query(
        `UPDATE money.invoice_dispute
            SET notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', $2::text, 'text', $3::text)),
                last_activity_at = now(), version = version + 1
          WHERE id = $1`,
        [id, actorUserId, note.trim()],
      );
    });
  }

  /**
   * Closes it: 'resolved' (settled either way — what was agreed goes in the
   * resolution) or 'withdrawn' (the customer dropped it). Finance charges
   * resume on the amount from the next run; nothing is written off here.
   */
  close(tenantId: string, actorUserId: string, id: string, dto: { version: number; outcome: 'resolved' | 'withdrawn'; resolution: string }): Promise<InvoiceDispute> {
    return this.change(tenantId, actorUserId, id, async (client, before) => {
      if (before.status !== 'open') throw new ConflictException('This dispute is already closed');
      const result = await client.query(
        `UPDATE money.invoice_dispute
            SET status = $3, resolution = $4, resolved_at = now(), resolved_by = $5, last_activity_at = now(), version = version + 1
          WHERE id = $1 AND version = $2`,
        [id, dto.version, dto.outcome, dto.resolution.trim(), actorUserId],
      );
      if (!result.rowCount) throw new ConflictException('This dispute was changed by someone else — reload and try again');
    });
  }

  private change(
    tenantId: string,
    actorUserId: string,
    id: string,
    apply: (client: PoolClient, before: InvoiceDispute) => Promise<void>,
  ): Promise<InvoiceDispute> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.findWithClient(client, id);
      await apply(client, before);
      const after = await this.findWithClient(client, id);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: DISPUTE_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  private async findWithClient(client: PoolClient, id: string): Promise<InvoiceDispute> {
    const row = (await client.query<DisputeRow>(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
    if (!row) throw new NotFoundException('Dispute not found');
    return toDispute(row);
  }
}
