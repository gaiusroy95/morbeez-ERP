import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { compareMoney, isPositiveMoney, moneyFromNumber, subtractMoney } from '../../common/money';
import { CustomersService } from '../customers/customers.service';
import { LedgerAccount, LedgerRepository } from './repositories/ledger.repository';
import { AdjustableInvoice, AdjustmentsRepository } from './repositories/adjustments.repository';
import { ReceivablesRepository } from './repositories/receivables.repository';
import { CreditNoteRecord, InvoiceKind, ReceivableWriteOffRecord } from './entities/finance-engine.entity';
import { splitCreditNote } from './finance-math';

/**
 * What a credit note takes back from, by the kind of invoice (CN.2): a sale's
 * goes to Sales returns and allowances (contra revenue — gross sales and the
 * return rate both stay visible); a finance charge's and a crate charge's
 * reverse the income they raised.
 */
export function creditNoteAccount(kind: InvoiceKind): LedgerAccount {
  if (kind === 'finance_charge') return 'finance_charge_income';
  if (kind === 'crate_charge') return 'crate_recoveries';
  return 'sales_returns';
}

/**
 * What lowers a receivable other than a payment: credit notes (Accounting
 * Engine CN.1–CN.4) and bad-debt write-offs (BD.1, BD.2, BD.4). Neither ever
 * edits an invoice — each is its own document with its own ledger entry, and
 * invoice_balance nets it off what's outstanding. Serialised on the customer,
 * like every other write to their balance.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AdjustmentsRepository,
    private readonly receivables: ReceivablesRepository,
    private readonly ledger: LedgerRepository,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  // ---- Credit notes ----

  /** Issued directly (a quality decision, a price agreed after delivery) rather than by settling a dispute. */
  issueCreditNote(tenantId: string, actorUserId: string, dto: { invoiceId: string; amount: number; reason: string }): Promise<CreditNoteRecord> {
    return this.db.withTenant(tenantId, (client) =>
      this.issueCreditNoteWithClient(client, tenantId, actorUserId, {
        invoiceId: dto.invoiceId,
        amount: moneyFromNumber(dto.amount),
        reason: dto.reason,
        disputeId: null,
      }),
    );
  }

  /**
   * CN.1: against one invoice, never editing it —
   *   Dr Sales returns and allowances   the value credited       (CN.2)
   *   Dr Output CGST / SGST / IGST / cess  the GST it carried  (GST Act s.34)
   *   Cr Accounts receivable            the whole note (the customer)
   * CN.4: approved by someone other than whoever issued the invoice. No more
   * than is outstanding and not under another open dispute — a refund of
   * money already paid isn't a credit note.
   */
  async issueCreditNoteWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: { invoiceId: string; amount: string; reason: string; disputeId: string | null },
  ): Promise<CreditNoteRecord> {
    const invoice = await this.lockedInvoice(client, input.invoiceId);
    if (invoice.createdBy === actorUserId) {
      throw new ForbiddenException(
        `You issued ${invoice.invoiceNumber} — a credit note against it needs someone else's approval (segregation of duties)`,
      );
    }
    if (!isPositiveMoney(input.amount)) throw new BadRequestException('A credit note must be for more than ₹0');
    const otherDisputes = await this.repo.openDisputedWithClient(client, invoice.id, input.disputeId);
    const room = subtractMoney(invoice.outstanding, otherDisputes);
    if (compareMoney(input.amount, room) > 0) {
      throw new ConflictException(
        compareMoney(otherDisputes, '0') > 0
          ? `Only ₹${room} of ${invoice.invoiceNumber} is outstanding and not under another open dispute`
          : `Only ₹${invoice.outstanding} of ${invoice.invoiceNumber} is outstanding — a credit note can't be more (money already paid needs a refund)`,
      );
    }
    const lines = await this.repo.taxedLinesWithClient(client, invoice.id);
    let split: ReturnType<typeof splitCreditNote>;
    try {
      split = splitCreditNote(input.amount, lines);
    } catch (err) {
      throw new ConflictException(`${invoice.invoiceNumber}'s lines don't carry ₹${input.amount}: ${(err as Error).message}`);
    }

    const id = randomUUID();
    const number = await this.repo.nextCreditNoteNumberWithClient(client, tenantId);
    const reason = input.reason.trim();
    const entryId = await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'credit_note_issued',
      sourceType: 'credit_note',
      sourceId: id,
      occurredAt: new Date(),
      memo: `${number} to ${invoice.customerName} against ${invoice.invoiceNumber}: ${reason}`,
      createdBy: actorUserId,
      lines: [
        { account: creditNoteAccount(invoice.kind), debit: split.taxableValue },
        { account: 'output_cgst', debit: split.cgst },
        { account: 'output_sgst', debit: split.sgst },
        { account: 'output_igst', debit: split.igst },
        { account: 'output_cess', debit: split.cess },
        { account: 'accounts_receivable', party: { type: 'customer', id: invoice.customerId }, credit: split.amount },
      ],
    });
    await this.repo.insertCreditNoteWithClient(client, {
      id,
      tenantId,
      number,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      disputeId: input.disputeId,
      reason,
      taxableValue: split.taxableValue,
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      cess: split.cess,
      amount: split.amount,
      issuedBy: actorUserId,
      entryId,
      lines: split.lines,
    });
    const note = (await this.repo.findCreditNoteWithClient(client, id)) as CreditNoteRecord;
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: 'credit_note',
      entityId: id,
      after: note as unknown as Record<string, unknown>,
    });
    return note;
  }

  listCreditNotes(tenantId: string, filter: { customerId?: string; invoiceId?: string }): Promise<CreditNoteRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.listCreditNotesWithClient(client, filter));
  }

  async getCreditNote(tenantId: string, id: string): Promise<CreditNoteRecord> {
    const note = await this.db.withTenant(tenantId, (client) => this.repo.findCreditNoteWithClient(client, id));
    if (!note) throw new NotFoundException('Credit note not found');
    return note;
  }

  // ---- Bad debts ----

  /**
   * Writes off what's left on an invoice as uncollectible — a deliberate
   * decision by the owner or a finance lead (BD.2; never automatic, MS §32):
   *   Dr Bad debts / Cr Allowance for doubtful accounts      (BD.1, the provision)
   *   Dr Allowance for doubtful accounts / Cr Accounts receivable  (BD.2, the customer)
   * and puts the customer on credit hold for a review of their terms (BD.4).
   * Not while a dispute on it is open — settle that first. A finance-charge
   * invoice is written off the same way (FC.3).
   */
  writeOff(tenantId: string, actorUserId: string, invoiceId: string, dto: { reason: string }): Promise<ReceivableWriteOffRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const invoice = await this.lockedInvoice(client, invoiceId);
      if (await this.repo.writeOffOfInvoiceWithClient(client, invoice.id)) {
        throw new ConflictException(`${invoice.invoiceNumber} has already been written off`);
      }
      if (!isPositiveMoney(invoice.outstanding)) throw new ConflictException(`Nothing is outstanding on ${invoice.invoiceNumber}`);
      if (compareMoney(await this.repo.openDisputedWithClient(client, invoice.id, null), '0') > 0) {
        throw new ConflictException(`${invoice.invoiceNumber} has an open dispute — settle it before writing anything off`);
      }
      const reason = dto.reason.trim();
      const id = randomUUID();
      const amount = invoice.outstanding;
      const at = new Date();
      const provisionEntryId = await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'bad_debt_provisioned',
        sourceType: 'receivable_write_off',
        sourceId: id,
        occurredAt: at,
        memo: `Provision for ${invoice.invoiceNumber} (${invoice.customerName}), written off: ${reason}`,
        createdBy: actorUserId,
        lines: [
          { account: 'bad_debt_expense', debit: amount },
          { account: 'allowance_doubtful_accounts', credit: amount },
        ],
      });
      const entryId = await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'receivable_written_off',
        sourceType: 'receivable_write_off',
        sourceId: id,
        occurredAt: at,
        memo: `${invoice.invoiceNumber} written off as uncollectible (${invoice.customerName}): ${reason}`,
        createdBy: actorUserId,
        lines: [
          { account: 'allowance_doubtful_accounts', debit: amount },
          { account: 'accounts_receivable', party: { type: 'customer', id: invoice.customerId }, credit: amount },
        ],
      });
      await this.repo.insertWriteOffWithClient(client, {
        id,
        tenantId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        reason,
        writtenOffBy: actorUserId,
        provisionEntryId,
        entryId,
      });
      // BD.4: review the customer's credit before any more is given.
      await this.customers.holdForReviewWithClient(
        client,
        tenantId,
        actorUserId,
        invoice.customerId,
        `Bad debt written off on ${invoice.invoiceNumber} (₹${amount}) — review credit terms`,
      );
      const writeOff = (await this.repo.findWriteOffWithClient(client, id)) as ReceivableWriteOffRecord;
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'receivable_write_off',
        entityId: id,
        after: writeOff as unknown as Record<string, unknown>,
      });
      return writeOff;
    });
  }

  listWriteOffs(tenantId: string, customerId: string | undefined): Promise<ReceivableWriteOffRecord[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.listWriteOffsWithClient(client, customerId));
  }

  /** The invoice, read under its customer's lock so nothing else changes its balance meanwhile. */
  private async lockedInvoice(client: PoolClient, invoiceId: string): Promise<AdjustableInvoice> {
    const first = await this.repo.invoiceWithClient(client, invoiceId);
    if (!first) throw new NotFoundException('Invoice not found');
    await this.receivables.lockCustomerWithClient(client, first.customerId);
    return (await this.repo.invoiceWithClient(client, invoiceId)) as AdjustableInvoice;
  }
}
