import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { PaginatedResult } from '../../common/persistence/pagination';
import { compareMoney, isPositiveMoney, moneyFromNumber, subtractMoney, sumMoney } from '../../common/money';
import { CustomersService } from '../customers/customers.service';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { LedgerAccount, LedgerRepository } from './repositories/ledger.repository';
import { InvoiceFilter, OpenInvoice, ReceivablesRepository } from './repositories/receivables.repository';
import {
  CustomerPaymentRecord,
  FinanceChargeRecord,
  FinanceChargeRunResult,
  InvoiceKind,
  InvoiceRecord,
  PaymentMethod,
} from './entities/finance-engine.entity';
import { addDays, allocateInOrder, daysBetween, financeChargeAnnual, laterDate } from './finance-math';
import { RecordCustomerPaymentDto } from './dto/record-customer-payment.dto';

const PAYMENT_ENTITY = 'customer_payment';
const INVOICE_ENTITY = 'invoice';

// A charge smaller than this isn't worth an invoice. It isn't lost: the
// period isn't closed, so its days count toward the next run's charge.
export const MIN_FINANCE_CHARGE = '1.00';

// A payment dated this far ahead of the server clock is a typo, not a
// cheque that hasn't happened yet.
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface SaleInvoiceInput {
  orderId: string;
  customerId: string;
  deliveredAt: Date;
  lines: { orderLineId: string; productId: string; description: string; quantity: string; unitPrice: string }[];
  // Specific-lot cost of what was delivered (Accounting Engine, COGS.1-2);
  // null when no delivered line had a costed lot.
  costOfGoods: string | null;
}

export interface CollectionPaymentInput {
  collectionId: string;
  customerId: string;
  orderId: string;
  amount: string;
  method: PaymentMethod;
  notes: string | null;
  collectedAt: Date;
  /** Cash the driver holds until handover goes to the trip float, not the cash drawer. */
  receivedInto?: LedgerAccount;
}

/** Cash goes to the cash drawer; every other channel lands in the bank. */
export function receivingAccount(method: PaymentMethod): LedgerAccount {
  return method === 'cash' ? 'cash_on_hand' : 'bank';
}

/**
 * Receivables: invoices, collections, and finance charges (Event Catalog,
 * Invoice Issued / Payment Received; Accounting Engine, FC). Every write
 * posts its ledger entry in the same transaction as the record it
 * describes, and serialises on the customer so two collections can never
 * both apply the same outstanding balance.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly receivables: ReceivablesRepository,
    private readonly ledger: LedgerRepository,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly taxRules: TaxRulesService,
  ) {}

  // ---- Invoicing (called by Orders at delivery, inside its transaction) ----

  /**
   * Issues the sale invoice for a delivered order and recognises its cost:
   *   Dr Accounts receivable / Cr Revenue      — the invoice, goods at their
   *                          / Cr Output GST      value, plus GST (TaxRulesService)
   *   Dr Cost of goods sold  / Cr Inventory    — the lots that left
   * then applies any credit the customer already has on account. Returns
   * null for an order worth nothing (no invoice to issue).
   */
  async issueSaleInvoiceWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: SaleInvoiceInput,
  ): Promise<InvoiceRecord | null> {
    const existing = await this.receivables.findInvoiceByOrderWithClient(client, input.orderId);
    if (existing) return existing; // delivery retried — never invoice twice

    await this.receivables.lockCustomerWithClient(client, input.customerId);
    const customer = await this.customers.getByIdWithClient(client, input.customerId);
    const priced = await this.receivables.priceLinesWithClient(client, input.lines);

    if (input.costOfGoods && isPositiveMoney(input.costOfGoods)) {
      await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'cogs_recognized',
        sourceType: 'customer_order',
        sourceId: input.orderId,
        occurredAt: input.deliveredAt,
        memo: `Cost of goods delivered to ${customer.name}`,
        createdBy: actorUserId,
        lines: [
          { account: 'cost_of_goods_sold', debit: input.costOfGoods },
          { account: 'inventory_asset', credit: input.costOfGoods },
        ],
      });
    }
    if (!isPositiveMoney(priced.total)) return null;

    const today = await this.receivables.todayWithClient(client);
    // GST on each line's delivered value, by the rules in force today.
    const tax = await this.taxRules.computeInvoiceTaxWithClient(client, {
      customerId: customer.id,
      issuedOn: today,
      lines: input.lines.map((line, i) => ({ productId: line.productId, taxableValue: priced.amounts[i] })),
    });
    const invoiceNumber = await this.receivables.nextInvoiceNumberWithClient(client, tenantId, 'sale');
    const { invoiceId, lineIds } = await this.receivables.insertInvoiceWithClient(client, {
      tenantId,
      invoiceNumber,
      kind: 'sale',
      customerId: customer.id,
      orderId: input.orderId,
      sourceInvoiceId: null,
      issuedAt: input.deliveredAt,
      // Fixed now from the terms in force — a later terms change never re-dates it.
      dueDate: addDays(today, customer.paymentTermsDays),
      // What the customer owes: the goods plus any GST on them.
      amount: tax.total,
      createdBy: actorUserId,
      lines: input.lines.map((line, i) => ({
        orderLineId: line.orderLineId,
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: priced.amounts[i],
      })),
    });
    await this.taxRules.recordInvoiceTaxWithClient(client, tenantId, invoiceId, lineIds, tax);

    // Output GST is owed to the government, not earned: its own liabilities.
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'invoice_issued',
      sourceType: 'invoice',
      sourceId: invoiceId,
      occurredAt: input.deliveredAt,
      memo: `${invoiceNumber} to ${customer.name}`,
      createdBy: actorUserId,
      lines: [
        { account: 'accounts_receivable', party: { type: 'customer', id: customer.id }, debit: tax.total },
        { account: 'revenue_sales', credit: tax.taxableValue },
        { account: 'output_cgst', credit: tax.cgst },
        { account: 'output_sgst', credit: tax.sgst },
        { account: 'output_igst', credit: tax.igst },
        { account: 'output_cess', credit: tax.cess },
      ],
    });

    await this.applyHeldCreditWithClient(client, tenantId, customer.id);
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: INVOICE_ENTITY,
      entityId: invoiceId,
      after: {
        invoiceNumber,
        orderId: input.orderId,
        customerId: customer.id,
        amount: tax.total,
        taxableValue: tax.taxableValue,
        documentType: tax.documentType,
      },
    });
    return this.receivables.findInvoiceWithClient(client, invoiceId);
  }

  // ---- Collections ----

  async recordPayment(tenantId: string, actorUserId: string, dto: RecordCustomerPaymentDto): Promise<CustomerPaymentRecord> {
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (receivedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('receivedAt cannot be in the future');
    }
    const amount = moneyFromNumber(dto.amount);
    const fee = moneyFromNumber(dto.feeAmount ?? 0);
    if (compareMoney(fee, amount) >= 0) throw new BadRequestException('feeAmount must be less than amount');

    return this.db.withTenant(tenantId, async (client) => {
      const customer = await this.customers.getByIdWithClient(client, dto.customerId);
      await this.receivables.lockCustomerWithClient(client, customer.id);

      const open = await this.receivables.openInvoicesForCustomerWithClient(client, customer.id);
      const allocations = dto.allocations?.length
        ? this.explicitAllocations(open, amount, dto.allocations)
        : allocateInOrder(amount, open).allocations;

      const paymentId = await this.postPaymentWithClient(client, tenantId, actorUserId, {
        customerId: customer.id,
        customerName: customer.name,
        amount,
        fee,
        method: dto.method,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        collectionId: null,
        receivedAt,
        allocations,
      });
      return (await this.receivables.findPaymentWithClient(client, paymentId)) as CustomerPaymentRecord;
    });
  }

  /**
   * Money a driver collected at a delivery stop (called by Logistics inside
   * the transaction that records the collection). Applied to that order's
   * invoice first, then oldest due; if the invoice doesn't exist yet the
   * money waits on account and is applied when it's issued.
   */
  async recordCollectionPaymentWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: CollectionPaymentInput,
  ): Promise<CustomerPaymentRecord> {
    const customer = await this.customers.getByIdWithClient(client, input.customerId);
    await this.receivables.lockCustomerWithClient(client, customer.id);

    const open = await this.receivables.openInvoicesForCustomerWithClient(client, customer.id);
    const ordered = [...open.filter((i) => i.orderId === input.orderId), ...open.filter((i) => i.orderId !== input.orderId)];
    const { allocations } = allocateInOrder(input.amount, ordered);

    const paymentId = await this.postPaymentWithClient(client, tenantId, actorUserId, {
      customerId: customer.id,
      customerName: customer.name,
      amount: input.amount,
      fee: '0.00',
      method: input.method,
      reference: null,
      notes: input.notes,
      collectionId: input.collectionId,
      receivedAt: input.collectedAt,
      allocations,
      receivedInto: input.receivedInto,
    });
    return (await this.receivables.findPaymentWithClient(client, paymentId)) as CustomerPaymentRecord;
  }

  /**
   * A bounced cheque or charged-back transfer. The payment stays on record;
   * a reversal is added, the ledger entry is reversed line for line
   * (Accounting Engine, DE.4), and the invoices it paid fall due again.
   */
  async reversePayment(tenantId: string, actorUserId: string, paymentId: string, reason: string): Promise<CustomerPaymentRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const payment = await this.receivables.findPaymentWithClient(client, paymentId);
      if (!payment) throw new NotFoundException('Payment not found');
      await this.receivables.lockCustomerWithClient(client, payment.customerId);
      if (payment.reversedAt) throw new ConflictException('This payment has already been reversed');

      const original = await this.ledger.findEntryWithClient(client, 'payment_received', paymentId);
      if (!original) throw new ConflictException('This payment has no ledger entry to reverse');

      await this.receivables.insertReversalWithClient(client, tenantId, paymentId, reason, actorUserId);
      await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'payment_reversed',
        sourceType: PAYMENT_ENTITY,
        sourceId: paymentId,
        occurredAt: new Date(),
        memo: `Reversal of payment from ${payment.customerName}: ${reason}`,
        createdBy: actorUserId,
        reversesEntryId: original.id,
        lines: original.lines.map((line) => ({
          account: line.account,
          party: line.partyType && line.partyId ? { type: line.partyType, id: line.partyId } : undefined,
          debit: line.credit,
          credit: line.debit,
        })),
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: PAYMENT_ENTITY,
        entityId: paymentId,
        before: payment as unknown as Record<string, unknown>,
        after: { reversed: true, reason },
      });
      return (await this.receivables.findPaymentWithClient(client, paymentId)) as CustomerPaymentRecord;
    });
  }

  // ---- Credit (read by Orders' credit check) ----

  /** What the customer owes right now, net of credit already paid in. */
  async customerBalanceWithClient(
    client: PoolClient,
    customerId: string,
  ): Promise<{ invoicedOutstanding: string; unappliedCredit: string; balance: string; overdue: string; oldestOverdueDays: number | null }> {
    const b = await this.receivables.customerBalanceWithClient(client, customerId);
    return { ...b, balance: subtractMoney(b.invoicedOutstanding, b.unappliedCredit) };
  }

  // ---- Finance charges (Accounting Engine, FC.1-FC.3) ----

  /**
   * Accrues finance charges up to `asOf` (tenant-local; default today) on
   * every sale invoice past due + grace, at each customer's rate. Each
   * invoice's charge runs from where its last charge ended (or from the end
   * of grace) to asOf, on its balance outstanding now — so running this
   * daily charges the balance actually owed each day. A repeat run for the
   * same asOf charges nothing (unique period end). One transaction per
   * customer: a failure for one leaves the others' charges in place.
   */
  async runFinanceCharges(tenantId: string, actorUserId: string, asOfInput?: string): Promise<FinanceChargeRunResult> {
    const today = await this.db.withTenant(tenantId, (client) => this.receivables.todayWithClient(client));
    const asOf = asOfInput ?? today;
    if (asOf > today) throw new BadRequestException('asOf cannot be after today');

    const candidates = await this.db.withTenant(tenantId, (client) =>
      this.receivables.financeChargeCandidatesWithClient(client, asOf),
    );
    const byCustomer = new Map<string, typeof candidates>();
    for (const c of candidates) byCustomer.set(c.customerId, [...(byCustomer.get(c.customerId) ?? []), c]);

    const chargeIds: string[] = [];
    let deferred = 0;
    for (const [customerId, invoices] of byCustomer) {
      await this.db.withTenant(tenantId, async (client) => {
        await this.receivables.lockCustomerWithClient(client, customerId);
        const customer = await this.customers.getByIdWithClient(client, customerId);
        // Re-read under the lock: a payment may have landed since the scan.
        const open = new Map(
          (await this.receivables.openInvoicesForCustomerWithClient(client, customerId)).map((i) => [i.id, i]),
        );
        // A dispute pauses the charge on the disputed amount only (client Q&A, finance).
        const disputed = await this.receivables.openDisputedByInvoiceWithClient(client, invoices.map((i) => i.invoiceId));

        for (const candidate of invoices) {
          const current = open.get(candidate.invoiceId);
          if (!current || current.kind !== 'sale') continue;
          const periodStart = laterDate(candidate.lastPeriodEnd ?? '0000-01-01', addDays(candidate.dueDate, candidate.graceDays));
          const days = daysBetween(periodStart, asOf);
          if (days <= 0) continue;
          const underDispute = disputed.get(current.id) ?? '0.00';
          const principal = compareMoney(underDispute, current.outstanding) >= 0 ? '0.00' : subtractMoney(current.outstanding, underDispute);
          if (compareMoney(principal, '0') <= 0) continue;
          const amount = financeChargeAnnual(principal, customer.financeChargeRateAnnual, days);
          if (compareMoney(amount, MIN_FINANCE_CHARGE) < 0) {
            deferred += 1;
            continue;
          }
          chargeIds.push(
            await this.postFinanceChargeWithClient(client, tenantId, actorUserId, {
              customerId,
              customerName: customer.name,
              source: current,
              periodStart,
              periodEnd: asOf,
              days,
              principal,
              rate: customer.financeChargeRateAnnual,
              amount,
            }),
          );
        }
      });
    }

    const charges = await this.db.withTenant(tenantId, (client) => this.receivables.findChargesWithClient(client, chargeIds));
    return {
      asOf,
      charged: charges.length,
      total: sumMoney(charges.map((c) => c.amount)),
      deferredBelowMinimum: deferred,
      charges,
    };
  }

  // ---- Reads ----

  listInvoices(
    tenantId: string,
    filter: { customerId?: string; state: InvoiceFilter; kind?: InvoiceKind },
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<InvoiceRecord>> {
    return this.db.withTenant(tenantId, (client) => this.receivables.listInvoicesWithClient(client, filter, page, pageSize));
  }

  async getInvoice(tenantId: string, id: string): Promise<InvoiceRecord> {
    const invoice = await this.db.withTenant(tenantId, (client) => this.receivables.findInvoiceWithClient(client, id));
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  listPayments(tenantId: string, customerId: string | undefined, page: number, pageSize: number) {
    return this.db.withTenant(tenantId, (client) => this.receivables.listPaymentsWithClient(client, customerId, page, pageSize));
  }

  async getPayment(tenantId: string, id: string): Promise<CustomerPaymentRecord> {
    const payment = await this.db.withTenant(tenantId, (client) => this.receivables.findPaymentWithClient(client, id));
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  listFinanceCharges(
    tenantId: string,
    customerId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<FinanceChargeRecord>> {
    return this.db.withTenant(tenantId, (client) => this.receivables.listChargesWithClient(client, customerId, page, pageSize));
  }

  // ---- Internals ----

  private explicitAllocations(
    open: OpenInvoice[],
    amount: string,
    requested: { invoiceId: string; amount: number }[],
  ): { id: string; amount: string }[] {
    const seen = new Set<string>();
    const allocations = requested.map((r) => {
      if (seen.has(r.invoiceId)) throw new BadRequestException('Each invoice may appear only once in allocations');
      seen.add(r.invoiceId);
      const invoice = open.find((i) => i.id === r.invoiceId);
      if (!invoice) throw new BadRequestException(`Invoice ${r.invoiceId} is not an open invoice of this customer`);
      const value = moneyFromNumber(r.amount);
      if (!isPositiveMoney(value)) throw new BadRequestException('Allocation amounts must be positive');
      if (compareMoney(value, invoice.outstanding) > 0) {
        throw new BadRequestException(`${invoice.invoiceNumber} has only ${invoice.outstanding} outstanding`);
      }
      return { id: invoice.id, amount: value };
    });
    if (compareMoney(sumMoney(allocations.map((a) => a.amount)), amount) > 0) {
      throw new BadRequestException('Allocations add up to more than the payment');
    }
    return allocations;
  }

  /**
   *   Dr Cash on hand / Bank   amount − fee
   *   Dr Finance costs         fee (what the channel kept)
   *   Cr Accounts receivable   amount (the customer is credited in full)
   */
  private async postPaymentWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    p: {
      customerId: string;
      customerName: string;
      amount: string;
      fee: string;
      method: PaymentMethod;
      reference: string | null;
      notes: string | null;
      collectionId: string | null;
      receivedAt: Date;
      allocations: { id: string; amount: string }[];
      // Where the money lands, when not the method's usual account (a driver's spot-sale cash).
      receivedInto?: LedgerAccount;
    },
  ): Promise<string> {
    const paymentId = await this.receivables.insertPaymentWithClient(client, {
      tenantId,
      customerId: p.customerId,
      amount: p.amount,
      feeAmount: p.fee,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      collectionId: p.collectionId,
      receivedAt: p.receivedAt,
      recordedBy: actorUserId,
    });
    await this.receivables.insertAllocationsWithClient(
      client,
      tenantId,
      p.allocations.map((a) => ({ paymentId, invoiceId: a.id, amount: a.amount })),
    );
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'payment_received',
      sourceType: PAYMENT_ENTITY,
      sourceId: paymentId,
      occurredAt: p.receivedAt,
      memo: `Payment from ${p.customerName} (${p.method}${p.reference ? `, ${p.reference}` : ''})`,
      createdBy: actorUserId,
      lines: [
        { account: p.receivedInto ?? receivingAccount(p.method), debit: subtractMoney(p.amount, p.fee) },
        { account: 'finance_costs', debit: p.fee },
        { account: 'accounts_receivable', party: { type: 'customer', id: p.customerId }, credit: p.amount },
      ],
    });
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: PAYMENT_ENTITY,
      entityId: paymentId,
      after: {
        customerId: p.customerId,
        amount: p.amount,
        feeAmount: p.fee,
        method: p.method,
        collectionId: p.collectionId,
        allocations: p.allocations,
      },
    });
    return paymentId;
  }

  // ---- Crate charges (called by Crates, inside its transaction) ----

  /**
   * Charges a customer for crates they lost: its own invoice ('crate_charge',
   * CRT-000001), taxed by the tenant's GST rules on the crate type's HSN — a
   * charge for lost crates is a supply of those crates — and due on the
   * customer's usual terms:
   *   Dr Accounts receivable / Cr Crate loss recoveries / Cr Output GST
   */
  async issueCrateChargeWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: { customerId: string; movementId: string; description: string; quantity: string; unitPrice: string; hsnCode: string | null; occurredAt: Date },
  ): Promise<{ invoiceId: string; invoiceNumber: string; amount: string; taxAmount: string; entryId: string }> {
    await this.receivables.lockCustomerWithClient(client, input.customerId);
    const customer = await this.customers.getByIdWithClient(client, input.customerId);
    const priced = await this.receivables.priceLinesWithClient(client, [{ quantity: input.quantity, unitPrice: input.unitPrice }]);
    if (!isPositiveMoney(priced.total)) throw new BadRequestException('The charge comes to nothing');
    const today = await this.receivables.todayWithClient(client);
    const tax = await this.taxRules.computeInvoiceTaxWithClient(client, {
      customerId: customer.id,
      issuedOn: today,
      lines: [{ productId: null, hsnCode: input.hsnCode, taxableValue: priced.total }],
    });
    const invoiceNumber = await this.receivables.nextInvoiceNumberWithClient(client, tenantId, 'crate_charge');
    const { invoiceId, lineIds } = await this.receivables.insertInvoiceWithClient(client, {
      tenantId,
      invoiceNumber,
      kind: 'crate_charge',
      customerId: customer.id,
      orderId: null,
      sourceInvoiceId: null,
      issuedAt: input.occurredAt,
      dueDate: addDays(today, customer.paymentTermsDays),
      amount: tax.total,
      createdBy: actorUserId,
      lines: [
        { orderLineId: null, productId: null, description: input.description, quantity: input.quantity, unitPrice: input.unitPrice, amount: priced.total },
      ],
    });
    await this.taxRules.recordInvoiceTaxWithClient(client, tenantId, invoiceId, lineIds, tax);
    const entryId = await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'crate_charge_invoiced',
      sourceType: 'invoice',
      sourceId: invoiceId,
      occurredAt: input.occurredAt,
      memo: `${invoiceNumber} to ${customer.name}: ${input.description}`,
      createdBy: actorUserId,
      lines: [
        { account: 'accounts_receivable', party: { type: 'customer', id: customer.id }, debit: tax.total },
        { account: 'crate_recoveries', credit: tax.taxableValue },
        { account: 'output_cgst', credit: tax.cgst },
        { account: 'output_sgst', credit: tax.sgst },
        { account: 'output_igst', credit: tax.igst },
        { account: 'output_cess', credit: tax.cess },
      ],
    });
    await this.applyHeldCreditWithClient(client, tenantId, customer.id);
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: INVOICE_ENTITY,
      entityId: invoiceId,
      after: { invoiceNumber, kind: 'crate_charge', customerId: customer.id, crateMovementId: input.movementId, amount: tax.total, taxableValue: tax.taxableValue },
    });
    return { invoiceId, invoiceNumber, amount: tax.total, taxAmount: subtractMoney(tax.total, tax.taxableValue), entryId };
  }

  // ---- Spot sales (called by Spot sales, inside its transaction) ----

  /**
   * A driver's sale to a walk-in buyer, paid on the spot: its own invoice
   * ('spot_sale', SPT-000001) to the tenant's walk-in customer, GST by the
   * tax rules on each product, and the payment applied to it at once —
   *   Dr Accounts receivable / Cr Sales / Cr Output GST
   *   Dr Cash with drivers (cash — the driver holds it until the trip is
   *      reconciled) or Bank (UPI) / Cr Accounts receivable
   * so the walk-in customer never carries a balance.
   */
  async issueSpotSaleWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: {
      saleId: string;
      saleNumber: string;
      buyer: string | null;
      lines: { productId: string; description: string; quantity: string; unitPrice: string }[];
      method: 'cash' | 'upi';
      reference: string | null;
      occurredAt: Date;
    },
  ): Promise<{ invoiceId: string; invoiceNumber: string; taxableValue: string; total: string; paymentId: string }> {
    const customerId = await this.receivables.walkInCustomerWithClient(client, tenantId, actorUserId);
    await this.receivables.lockCustomerWithClient(client, customerId);
    const priced = await this.receivables.priceLinesWithClient(client, input.lines);
    const today = await this.receivables.todayWithClient(client);
    const tax = await this.taxRules.computeInvoiceTaxWithClient(client, {
      customerId,
      issuedOn: today,
      lines: input.lines.map((l, i) => ({ productId: l.productId, taxableValue: priced.amounts[i] })),
    });
    const invoiceNumber = await this.receivables.nextInvoiceNumberWithClient(client, tenantId, 'spot_sale');
    const { invoiceId, lineIds } = await this.receivables.insertInvoiceWithClient(client, {
      tenantId,
      invoiceNumber,
      kind: 'spot_sale',
      customerId,
      orderId: null,
      sourceInvoiceId: null,
      issuedAt: input.occurredAt,
      dueDate: today,
      amount: tax.total,
      createdBy: actorUserId,
      lines: input.lines.map((l, i) => ({
        orderLineId: null,
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: priced.amounts[i],
      })),
    });
    await this.taxRules.recordInvoiceTaxWithClient(client, tenantId, invoiceId, lineIds, tax);
    const label = `${input.saleNumber}${input.buyer ? ` to ${input.buyer}` : ' (walk-in)'}`;
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'invoice_issued',
      sourceType: 'invoice',
      sourceId: invoiceId,
      occurredAt: input.occurredAt,
      memo: `${invoiceNumber}: spot sale ${label}`,
      createdBy: actorUserId,
      lines: [
        { account: 'accounts_receivable', party: { type: 'customer', id: customerId }, debit: tax.total },
        { account: 'revenue_sales', credit: tax.taxableValue },
        { account: 'output_cgst', credit: tax.cgst },
        { account: 'output_sgst', credit: tax.sgst },
        { account: 'output_igst', credit: tax.igst },
        { account: 'output_cess', credit: tax.cess },
      ],
    });
    const paymentId = await this.postPaymentWithClient(client, tenantId, actorUserId, {
      customerId,
      customerName: 'Walk-in customers',
      amount: tax.total,
      fee: '0.00',
      method: input.method,
      reference: input.reference,
      notes: `Spot sale ${label}`,
      collectionId: null,
      receivedAt: input.occurredAt,
      allocations: [{ id: invoiceId, amount: tax.total }],
      receivedInto: input.method === 'cash' ? 'cash_with_drivers' : 'bank',
    });
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: INVOICE_ENTITY,
      entityId: invoiceId,
      after: { invoiceNumber, kind: 'spot_sale', spotSaleId: input.saleId, amount: tax.total, taxableValue: tax.taxableValue },
    });
    return { invoiceId, invoiceNumber, taxableValue: tax.taxableValue, total: tax.total, paymentId };
  }

  /** Credit on account (earlier unapplied payments) is drawn down against open invoices, oldest first. */
  private async applyHeldCreditWithClient(client: PoolClient, tenantId: string, customerId: string): Promise<void> {
    const held = await this.receivables.unappliedPaymentsForCustomerWithClient(client, customerId);
    if (held.length === 0) return;
    let open = await this.receivables.openInvoicesForCustomerWithClient(client, customerId);
    for (const payment of held) {
      const { allocations } = allocateInOrder(payment.unapplied, open);
      if (allocations.length === 0) break;
      await this.receivables.insertAllocationsWithClient(
        client,
        tenantId,
        allocations.map((a) => ({ paymentId: payment.id, invoiceId: a.id, amount: a.amount })),
      );
      open = open.map((i) => {
        const taken = allocations.find((a) => a.id === i.id);
        return taken ? { ...i, outstanding: subtractMoney(i.outstanding, taken.amount) } : i;
      });
    }
  }

  /** A finance-charge invoice, due at once:  Dr Accounts receivable / Cr Finance charge income. */
  private async postFinanceChargeWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    c: {
      customerId: string;
      customerName: string;
      source: OpenInvoice;
      periodStart: string;
      periodEnd: string;
      days: number;
      principal: string;
      rate: string;
      amount: string;
    },
  ): Promise<string> {
    const invoiceNumber = await this.receivables.nextInvoiceNumberWithClient(client, tenantId, 'finance_charge');
    const description = `Finance charge on ${c.source.invoiceNumber}: ${c.principal} × ${c.rate}% a year × ${c.days} days ÷ 365`;
    const { invoiceId } = await this.receivables.insertInvoiceWithClient(client, {
      tenantId,
      invoiceNumber,
      kind: 'finance_charge',
      customerId: c.customerId,
      orderId: null,
      sourceInvoiceId: c.source.id,
      issuedAt: new Date(),
      dueDate: c.periodEnd,
      amount: c.amount,
      createdBy: actorUserId,
      lines: [
        { orderLineId: null, productId: null, description, quantity: '1', unitPrice: c.amount, amount: c.amount },
      ],
    });
    const chargeId = await this.receivables.insertFinanceChargeWithClient(client, {
      tenantId,
      invoiceId,
      sourceInvoiceId: c.source.id,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      principal: c.principal,
      rate: c.rate,
      days: c.days,
      amount: c.amount,
      createdBy: actorUserId,
    });
    await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'finance_charge_accrued',
      sourceType: 'invoice',
      sourceId: invoiceId,
      occurredAt: new Date(),
      memo: `${invoiceNumber} to ${c.customerName}: ${description}`,
      createdBy: actorUserId,
      lines: [
        { account: 'accounts_receivable', party: { type: 'customer', id: c.customerId }, debit: c.amount },
        { account: 'finance_charge_income', credit: c.amount },
      ],
    });
    await this.applyHeldCreditWithClient(client, tenantId, c.customerId);
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: INVOICE_ENTITY,
      entityId: invoiceId,
      after: { invoiceNumber, sourceInvoiceId: c.source.id, periodStart: c.periodStart, periodEnd: c.periodEnd, amount: c.amount },
    });
    return chargeId;
  }
}
