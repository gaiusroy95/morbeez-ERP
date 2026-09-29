import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { PaginatedResult } from '../../common/persistence/pagination';
import { compareMoney, isPositiveMoney, moneyFromNumber, subtractMoney, sumMoney } from '../../common/money';
import { FarmersService } from '../farmers/farmers.service';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { LedgerRepository } from './repositories/ledger.repository';
import { OpenPayable, PayablesRepository } from './repositories/payables.repository';
import { FarmerPaymentRecord, LotPaymentStatus } from './entities/finance-engine.entity';
import { allocateInOrder } from './finance-math';
import { receivingAccount } from './receivables.service';
import { RecordFarmerPaymentDto } from './dto/record-farmer-payment.dto';

const PAYMENT_ENTITY = 'farmer_payment';
const PAYABLE_ENTITY = 'farmer_payable';
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface LotAccrualInput {
  lotId: string;
  farmerId: string;
  acceptedQuantity: string;
  unitCost: string;
  gradedAt: Date;
}

/**
 * Called after a farmer payment commits with the lots it left fully paid.
 * Procurement registers one to close purchase orders — the direction of
 * the dependency stays Procurement → Finance, never back.
 */
export type LotsPaidListener = (tenantId: string, actorUserId: string, lotIds: string[]) => Promise<void>;

/**
 * Payables to farmers (Event Catalog, Lot Graded / Farmer Payment Made;
 * Accounting Engine, ADV). Every write posts its ledger entry in the same
 * transaction and serialises on the farmer.
 */
@Injectable()
export class PayablesService {
  private readonly logger = new Logger(PayablesService.name);
  private readonly lotsPaidListeners: LotsPaidListener[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly payables: PayablesRepository,
    private readonly ledger: LedgerRepository,
    private readonly farmers: FarmersService,
    private readonly audit: AuditService,
    private readonly taxRules: TaxRulesService,
  ) {}

  onLotsPaid(listener: LotsPaidListener): void {
    this.lotsPaidListeners.push(listener);
  }

  // ---- Accrual (called by Procurement at grading, inside its transaction) ----

  /**
   * The lot's cost is now fixed (LOT.2), so it's owed:
   *   Dr Inventory asset          accepted × unit cost
   *   Cr Farmer advances          up to what the farmer was paid ahead (ADV.2)
   *   Cr Accounts payable         the rest
   * Returns null for a lot worth nothing (fully rejected, or zero cost).
   */
  async accrueLotPayableWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: LotAccrualInput,
  ): Promise<LotPaymentStatus | null> {
    const amount = await this.payables.lotValueWithClient(client, input.acceptedQuantity, input.unitCost);
    if (!isPositiveMoney(amount)) return null;

    await this.payables.lockFarmerWithClient(client, input.farmerId);
    const payableId = await this.payables.insertPayableWithClient(client, {
      tenantId,
      lotId: input.lotId,
      farmerId: input.farmerId,
      amount,
      accruedAt: input.gradedAt,
      createdBy: actorUserId,
    });

    // TDS falls due on credit, which is now: withheld from what's owed,
    // owed to the government instead (TaxRulesService decides whether and
    // how much, from the tenant's configured section).
    const year = await this.payables.accruedThisYearWithClient(client, input.farmerId, input.gradedAt, payableId);
    const tds = await this.taxRules.assessFarmerTdsWithClient(client, {
      farmerId: input.farmerId,
      amount,
      date: year.date,
      priorThisYear: year.prior,
    });
    const withheld = tds?.tdsAmount ?? '0.00';

    // Draw down advances, oldest first.
    let remaining = subtractMoney(amount, withheld);
    const advances = await this.payables.unappliedPaymentsForFarmerWithClient(client, input.farmerId);
    const drawn: { paymentId: string; payableId: string; amount: string }[] = [];
    for (const advance of advances) {
      if (!isPositiveMoney(remaining)) break;
      const { allocations } = allocateInOrder(advance.unapplied, [{ id: payableId, outstanding: remaining }]);
      for (const a of allocations) {
        drawn.push({ paymentId: advance.id, payableId, amount: a.amount });
        remaining = subtractMoney(remaining, a.amount);
      }
    }
    await this.payables.insertAllocationsWithClient(client, tenantId, drawn);
    const fromAdvance = sumMoney(drawn.map((d) => d.amount));

    const entryId = await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'payable_accrued',
      sourceType: PAYABLE_ENTITY,
      sourceId: payableId,
      occurredAt: input.gradedAt,
      memo: `Lot graded — owed to farmer${isPositiveMoney(fromAdvance) ? ` (${fromAdvance} met from advance)` : ''}${
        tds ? ` (TDS ${withheld} under ${tds.section.code})` : ''
      }`,
      createdBy: actorUserId,
      lines: [
        { account: 'inventory_asset', debit: amount },
        { account: 'tds_payable', credit: withheld },
        { account: 'farmer_advance', party: { type: 'farmer', id: input.farmerId }, credit: fromAdvance },
        { account: 'accounts_payable_farmer', party: { type: 'farmer', id: input.farmerId }, credit: remaining },
      ],
    });
    if (tds) {
      await this.taxRules.recordDeductionWithClient(client, {
        tenantId,
        sectionId: tds.section.id,
        sectionCode: tds.section.code,
        farmerId: input.farmerId,
        payeeName: tds.payeeName,
        payeePan: tds.pan,
        deducteeType: tds.deducteeType,
        baseAmount: tds.baseAmount,
        grossAmount: amount,
        rate: tds.rate,
        tdsAmount: withheld,
        deductedOn: year.date,
        payableId,
        sourceType: PAYABLE_ENTITY,
        sourceId: payableId,
        ledgerEntryId: entryId,
        createdBy: actorUserId,
      });
    }
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: PAYABLE_ENTITY,
      entityId: payableId,
      after: { lotId: input.lotId, farmerId: input.farmerId, amount, fromAdvance, tdsWithheld: withheld },
    });
    return { lotId: input.lotId, payable: amount, paid: sumMoney([fromAdvance, withheld]), outstanding: remaining };
  }

  // ---- Payments ----

  /**
   *   Dr Accounts payable     what's applied to lots
   *   Dr Farmer advances      what's paid ahead of any lot (ADV.1)
   *   Dr Finance costs        the transfer fee, if any
   *   Cr Bank / Cash on hand  amount + fee
   */
  async recordPayment(tenantId: string, actorUserId: string, dto: RecordFarmerPaymentDto): Promise<FarmerPaymentRecord> {
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) throw new BadRequestException('paidAt cannot be in the future');
    const amount = moneyFromNumber(dto.amount);
    const fee = moneyFromNumber(dto.feeAmount ?? 0);
    const farmerName = (await this.farmers.getById(tenantId, dto.farmerId)).name;

    const { payment, fullyPaidLots } = await this.db.withTenant(tenantId, async (client) => {
      await this.payables.lockFarmerWithClient(client, dto.farmerId);

      const open = await this.payables.openPayablesForFarmerWithClient(client, dto.farmerId);
      const allocations = dto.allocations?.length
        ? this.explicitAllocations(open, amount, dto.allocations)
        : allocateInOrder(amount, open).allocations;
      const applied = sumMoney(allocations.map((a) => a.amount));
      const advance = subtractMoney(amount, applied);

      const paymentId = await this.payables.insertPaymentWithClient(client, {
        tenantId,
        farmerId: dto.farmerId,
        amount,
        feeAmount: fee,
        method: dto.method,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        paidAt,
        recordedBy: actorUserId,
      });
      await this.payables.insertAllocationsWithClient(
        client,
        tenantId,
        allocations.map((a) => ({ paymentId, payableId: a.id, amount: a.amount })),
      );
      await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'farmer_payment_made',
        sourceType: PAYMENT_ENTITY,
        sourceId: paymentId,
        occurredAt: paidAt,
        memo: `Payment to ${farmerName} (${dto.method}${dto.reference ? `, ${dto.reference}` : ''})`,
        createdBy: actorUserId,
        lines: [
          { account: 'accounts_payable_farmer', party: { type: 'farmer', id: dto.farmerId }, debit: applied },
          { account: 'farmer_advance', party: { type: 'farmer', id: dto.farmerId }, debit: advance },
          { account: 'finance_costs', debit: fee },
          { account: receivingAccount(dto.method), credit: sumMoney([amount, fee]) },
        ],
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: PAYMENT_ENTITY,
        entityId: paymentId,
        after: { farmerId: dto.farmerId, amount, feeAmount: fee, method: dto.method, allocations, advance },
      });

      const paidLots = allocations
        .filter((a) => compareMoney(a.amount, open.find((o) => o.id === a.id)?.outstanding ?? '0') === 0)
        .map((a) => open.find((o) => o.id === a.id)?.lotId as string);
      return {
        payment: (await this.payables.findPaymentWithClient(client, paymentId)) as FarmerPaymentRecord,
        fullyPaidLots: paidLots,
      };
    });

    // After COMMIT: a listener failure must not undo money already recorded.
    if (fullyPaidLots.length > 0) {
      for (const listener of this.lotsPaidListeners) {
        await listener(tenantId, actorUserId, fullyPaidLots).catch((err: Error) =>
          this.logger.error(`lots-paid listener failed: ${err.message}`, err.stack),
        );
      }
    }
    return payment;
  }

  // ---- Deductions (called by Crates, inside its transaction) ----

  /**
   * Takes a charge off what's owed to a farmer, oldest payable first — no
   * money moves; the payables simply come to less:
   *   Dr Accounts payable — farmer / Cr Crate loss recoveries
   * Refused when less than the charge is owed. The caller records which
   * payables it came off (money.farmer_payable_balance nets them), then
   * calls announceLotsPaid after COMMIT for any lot it left fully settled.
   */
  async deductWithClient(
    client: PoolClient,
    tenantId: string,
    actorUserId: string,
    input: { farmerId: string; amount: string; sourceType: string; sourceId: string; memo: string; occurredAt: Date },
  ): Promise<{ entryId: string; deductions: { payableId: string; amount: string }[]; fullyPaidLots: string[] }> {
    await this.payables.lockFarmerWithClient(client, input.farmerId);
    const open = await this.payables.openPayablesForFarmerWithClient(client, input.farmerId);
    const owed = sumMoney(open.map((o) => o.outstanding));
    if (compareMoney(owed, input.amount) < 0) {
      throw new ConflictException(`Only ${owed} is owed to this farmer — not enough to deduct ${input.amount} from`);
    }
    const { allocations } = allocateInOrder(input.amount, open);
    const entryId = await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'crate_charge_deducted',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt: input.occurredAt,
      memo: input.memo,
      createdBy: actorUserId,
      lines: [
        { account: 'accounts_payable_farmer', party: { type: 'farmer', id: input.farmerId }, debit: input.amount },
        { account: 'crate_recoveries', credit: input.amount },
      ],
    });
    const fullyPaidLots = allocations
      .filter((a) => compareMoney(a.amount, open.find((o) => o.id === a.id)?.outstanding ?? '0') === 0)
      .map((a) => open.find((o) => o.id === a.id)?.lotId as string);
    return { entryId, deductions: allocations.map((a) => ({ payableId: a.id, amount: a.amount })), fullyPaidLots };
  }

  /** After COMMIT: lots a deduction left fully settled, for the same listeners a payment tells. */
  async announceLotsPaid(tenantId: string, actorUserId: string, lotIds: string[]): Promise<void> {
    if (lotIds.length === 0) return;
    for (const listener of this.lotsPaidListeners) {
      await listener(tenantId, actorUserId, lotIds).catch((err: Error) => this.logger.error(`lots-paid listener failed: ${err.message}`, err.stack));
    }
  }

  // ---- Reads ----

  listPayments(
    tenantId: string,
    farmerId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<FarmerPaymentRecord>> {
    return this.db.withTenant(tenantId, (client) => this.payables.listPaymentsWithClient(client, farmerId, page, pageSize));
  }

  async getPayment(tenantId: string, id: string): Promise<FarmerPaymentRecord> {
    const payment = await this.db.withTenant(tenantId, (client) => this.payables.findPaymentWithClient(client, id));
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  lotPaymentStatus(tenantId: string, lotIds: string[]): Promise<LotPaymentStatus[]> {
    return this.db.withTenant(tenantId, (client) => this.payables.lotStatusWithClient(client, lotIds));
  }

  lotPaymentStatusWithClient(client: PoolClient, lotIds: string[]): Promise<LotPaymentStatus[]> {
    return this.payables.lotStatusWithClient(client, lotIds);
  }

  private explicitAllocations(
    open: OpenPayable[],
    amount: string,
    requested: { lotId: string; amount: number }[],
  ): { id: string; amount: string }[] {
    const seen = new Set<string>();
    const allocations = requested.map((r) => {
      if (seen.has(r.lotId)) throw new BadRequestException('Each lot may appear only once in allocations');
      seen.add(r.lotId);
      const payable = open.find((p) => p.lotId === r.lotId);
      if (!payable) throw new BadRequestException(`Lot ${r.lotId} has nothing owed to this farmer`);
      const value = moneyFromNumber(r.amount);
      if (!isPositiveMoney(value)) throw new BadRequestException('Allocation amounts must be positive');
      if (compareMoney(value, payable.outstanding) > 0) {
        throw new BadRequestException(`Only ${payable.outstanding} is owed on lot ${r.lotId}`);
      }
      return { id: payable.id, amount: value };
    });
    if (compareMoney(sumMoney(allocations.map((a) => a.amount)), amount) > 0) {
      throw new BadRequestException('Allocations add up to more than the payment');
    }
    return allocations;
  }
}
