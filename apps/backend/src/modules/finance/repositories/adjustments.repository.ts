import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CreditNoteRecord, InvoiceKind, ReceivableWriteOffRecord } from '../entities/finance-engine.entity';
import { TaxedLine } from '../finance-math';

export interface AdjustableInvoice {
  id: string;
  invoiceNumber: string;
  kind: InvoiceKind;
  customerId: string;
  customerName: string;
  amount: string;
  outstanding: string;
  createdBy: string;
}

interface CreditNoteRow {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  dispute_id: string | null;
  reason: string;
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  amount: string;
  issued_at: Date;
  issued_by: string;
  issued_by_login: string | null;
}

interface WriteOffRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  amount: string;
  reason: string;
  written_off_at: Date;
  written_off_by: string;
  written_off_by_login: string | null;
}

const CREDIT_NOTE_SELECT = `
  SELECT n.id, n.credit_note_number, n.invoice_id, i.invoice_number, n.customer_id, c.name AS customer_name, n.dispute_id,
         n.reason, n.taxable_value::text AS taxable_value, n.cgst::text AS cgst, n.sgst::text AS sgst, n.igst::text AS igst,
         n.cess::text AS cess, n.amount::text AS amount, n.issued_at, n.issued_by, COALESCE(u.email::text, u.phone) AS issued_by_login
    FROM money.credit_note n
    JOIN money.invoice i ON i.id = n.invoice_id
    JOIN trading_partners.customer c ON c.id = n.customer_id
    LEFT JOIN identity.app_user u ON u.id = n.issued_by`;

const WRITE_OFF_SELECT = `
  SELECT w.id, w.invoice_id, i.invoice_number, w.customer_id, c.name AS customer_name, w.amount::text AS amount, w.reason,
         w.written_off_at, w.written_off_by, COALESCE(u.email::text, u.phone) AS written_off_by_login
    FROM money.receivable_write_off w
    JOIN money.invoice i ON i.id = w.invoice_id
    JOIN trading_partners.customer c ON c.id = w.customer_id
    LEFT JOIN identity.app_user u ON u.id = w.written_off_by`;

const toCreditNote = (r: CreditNoteRow): CreditNoteRecord => ({
  id: r.id,
  creditNoteNumber: r.credit_note_number,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  customerId: r.customer_id,
  customerName: r.customer_name,
  disputeId: r.dispute_id,
  reason: r.reason,
  taxableValue: r.taxable_value,
  cgst: r.cgst,
  sgst: r.sgst,
  igst: r.igst,
  cess: r.cess,
  amount: r.amount,
  issuedAt: r.issued_at,
  issuedBy: r.issued_by,
  issuedByLogin: r.issued_by_login,
});

const toWriteOff = (r: WriteOffRow): ReceivableWriteOffRecord => ({
  id: r.id,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  customerId: r.customer_id,
  customerName: r.customer_name,
  amount: r.amount,
  reason: r.reason,
  writtenOffAt: r.written_off_at,
  writtenOffBy: r.written_off_by,
  writtenOffByLogin: r.written_off_by_login,
});

/** Credit notes and bad-debt write-offs: what reduces a receivable other than a payment. */
@Injectable()
export class AdjustmentsRepository {
  async invoiceWithClient(client: PoolClient, invoiceId: string): Promise<AdjustableInvoice | null> {
    const r = await client.query<{
      invoice_id: string;
      invoice_number: string;
      kind: InvoiceKind;
      customer_id: string;
      customer_name: string;
      amount: string;
      outstanding: string;
      created_by: string;
    }>(
      `SELECT b.invoice_id, b.invoice_number, b.kind, b.customer_id, c.name AS customer_name,
              b.amount::text AS amount, b.outstanding::text AS outstanding, b.created_by
         FROM money.invoice_balance b JOIN trading_partners.customer c ON c.id = b.customer_id
        WHERE b.invoice_id = $1`,
      [invoiceId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.invoice_id,
      invoiceNumber: row.invoice_number,
      kind: row.kind,
      customerId: row.customer_id,
      customerName: row.customer_name,
      amount: row.amount,
      outstanding: row.outstanding,
      createdBy: row.created_by,
    };
  }

  /** Whether the user holds the business's Owner role — the one who may approve a credit note on an invoice they issued (D10). */
  async isOwnerWithClient(client: PoolClient, userId: string): Promise<boolean> {
    const r = await client.query<{ owner: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM identity.user_role ur JOIN identity.role r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.name = 'Owner'
       ) AS owner`,
      [userId],
    );
    return r.rows[0].owner;
  }

  /** What's under open dispute on the invoice, leaving one dispute out (the one being settled). */
  async openDisputedWithClient(client: PoolClient, invoiceId: string, exceptDisputeId: string | null): Promise<string> {
    const r = await client.query<{ disputed: string }>(
      `SELECT COALESCE(SUM(amount), 0)::numeric(12,2)::text AS disputed
         FROM money.invoice_dispute WHERE invoice_id = $1 AND status = 'open' AND ($2::uuid IS NULL OR id <> $2)`,
      [invoiceId, exceptDisputeId],
    );
    return r.rows[0].disputed;
  }

  /** Each line of the invoice as it was taxed; a line taxed nothing (or before the tax layer) carries its amount untaxed. */
  async taxedLinesWithClient(client: PoolClient, invoiceId: string): Promise<TaxedLine[]> {
    const r = await client.query<{ id: string; taxable: string; cgst: string; sgst: string; igst: string; cess: string }>(
      `SELECT l.id, COALESCE(t.taxable_value, l.amount)::text AS taxable, COALESCE(t.cgst, 0)::text AS cgst,
              COALESCE(t.sgst, 0)::text AS sgst, COALESCE(t.igst, 0)::text AS igst, COALESCE(t.cess, 0)::text AS cess
         FROM money.invoice_line l LEFT JOIN tax.invoice_line_tax t ON t.invoice_line_id = l.id
        WHERE l.invoice_id = $1
        ORDER BY l.description, l.id`,
      [invoiceId],
    );
    return r.rows.map((x) => ({ invoiceLineId: x.id, taxableValue: x.taxable, cgst: x.cgst, sgst: x.sgst, igst: x.igst, cess: x.cess }));
  }

  /** Gap-free per tenant: CN-000001, from the invoices' counter. */
  async nextCreditNoteNumberWithClient(client: PoolClient, tenantId: string): Promise<string> {
    const r = await client.query<{ last_number: number }>(
      `INSERT INTO money.invoice_counter (tenant_id, kind, last_number) VALUES ($1, 'credit_note', 1)
       ON CONFLICT (tenant_id, kind) DO UPDATE SET last_number = money.invoice_counter.last_number + 1
       RETURNING last_number`,
      [tenantId],
    );
    return `CN-${String(r.rows[0].last_number).padStart(6, '0')}`;
  }

  async insertCreditNoteWithClient(
    client: PoolClient,
    n: {
      id: string;
      tenantId: string;
      number: string;
      invoiceId: string;
      customerId: string;
      disputeId: string | null;
      reason: string;
      taxableValue: string;
      cgst: string;
      sgst: string;
      igst: string;
      cess: string;
      amount: string;
      issuedBy: string;
      entryId: string;
      lines: TaxedLine[];
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.credit_note
         (id, tenant_id, credit_note_number, invoice_id, customer_id, dispute_id, reason, taxable_value, cgst, sgst, igst, cess, amount, issued_by, ledger_entry_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [n.id, n.tenantId, n.number, n.invoiceId, n.customerId, n.disputeId, n.reason, n.taxableValue, n.cgst, n.sgst, n.igst, n.cess, n.amount, n.issuedBy, n.entryId],
    );
    for (const l of n.lines) {
      await client.query(
        `INSERT INTO money.credit_note_line (tenant_id, credit_note_id, invoice_line_id, taxable_value, cgst, sgst, igst, cess)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [n.tenantId, n.id, l.invoiceLineId, l.taxableValue, l.cgst, l.sgst, l.igst, l.cess],
      );
    }
  }

  async findCreditNoteWithClient(client: PoolClient, id: string): Promise<CreditNoteRecord | null> {
    const r = await client.query<CreditNoteRow>(`${CREDIT_NOTE_SELECT} WHERE n.id = $1`, [id]);
    return r.rows[0] ? toCreditNote(r.rows[0]) : null;
  }

  async listCreditNotesWithClient(client: PoolClient, filter: { customerId?: string; invoiceId?: string }): Promise<CreditNoteRecord[]> {
    const r = await client.query<CreditNoteRow>(
      `${CREDIT_NOTE_SELECT}
        WHERE ($1::uuid IS NULL OR n.customer_id = $1) AND ($2::uuid IS NULL OR n.invoice_id = $2)
        ORDER BY n.issued_at DESC, n.credit_note_number DESC
        LIMIT 200`,
      [filter.customerId ?? null, filter.invoiceId ?? null],
    );
    return r.rows.map(toCreditNote);
  }

  async insertWriteOffWithClient(
    client: PoolClient,
    w: {
      id: string;
      tenantId: string;
      invoiceId: string;
      customerId: string;
      amount: string;
      reason: string;
      writtenOffBy: string;
      provisionEntryId: string;
      entryId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO money.receivable_write_off
         (id, tenant_id, invoice_id, customer_id, amount, reason, written_off_by, provision_entry_id, ledger_entry_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [w.id, w.tenantId, w.invoiceId, w.customerId, w.amount, w.reason, w.writtenOffBy, w.provisionEntryId, w.entryId],
    );
  }

  async findWriteOffWithClient(client: PoolClient, id: string): Promise<ReceivableWriteOffRecord | null> {
    const r = await client.query<WriteOffRow>(`${WRITE_OFF_SELECT} WHERE w.id = $1`, [id]);
    return r.rows[0] ? toWriteOff(r.rows[0]) : null;
  }

  async writeOffOfInvoiceWithClient(client: PoolClient, invoiceId: string): Promise<ReceivableWriteOffRecord | null> {
    const r = await client.query<WriteOffRow>(`${WRITE_OFF_SELECT} WHERE w.invoice_id = $1`, [invoiceId]);
    return r.rows[0] ? toWriteOff(r.rows[0]) : null;
  }

  async listWriteOffsWithClient(client: PoolClient, customerId: string | undefined): Promise<ReceivableWriteOffRecord[]> {
    const r = await client.query<WriteOffRow>(
      `${WRITE_OFF_SELECT} WHERE ($1::uuid IS NULL OR w.customer_id = $1) ORDER BY w.written_off_at DESC LIMIT 200`,
      [customerId ?? null],
    );
    return r.rows.map(toWriteOff);
  }
}
