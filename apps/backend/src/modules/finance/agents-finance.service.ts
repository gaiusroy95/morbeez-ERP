import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { compareMoney, isPositiveMoney, moneyFromNumber, percentOfMoney, subtractMoney } from '../../common/money';
import { deducteeTypeFromPan } from '../../common/india';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { TaxRulesRepository } from '../tax-rules/repositories/tax-rules.repository';
import { DeducteeType } from '../tax-rules/entities/tax-rules.entity';
import { LedgerRepository } from './repositories/ledger.repository';
import { AgentsFinanceRepository } from './repositories/agents-finance.repository';
import { AgentAccount, AgentPaymentRecord, PaymentMethod } from './entities/finance-engine.entity';
import { agentCommission } from './finance-math';
import { receivingAccount } from './receivables.service';

const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface LotCommissionInput {
  lotId: string;
  purchaseOrderId: string;
  agentId: string;
  agentName: string;
  ratePerKg: string;
  acceptedQuantity: string;
  uom: string;
  gradedAt: Date;
}

/**
 * Agents' commission (Master Spec §11; Accounting Engine AGT.1–AGT.3): earned
 * on the kg accepted when a lot is graded — not when the agent is engaged —
 * into its own payable sub-ledger, separate from farmers and customers, each
 * entry traceable to the lot and the rate. Settled by payments, with TDS
 * withheld when the business chooses a section (194H for commission —
 * required only of payers liable to tax audit, so it's the business's call).
 */
@Injectable()
export class AgentsFinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AgentsFinanceRepository,
    private readonly ledger: LedgerRepository,
    private readonly taxRules: TaxRulesService,
    private readonly taxRulesRepo: TaxRulesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Called by Procurement at grading, in its transaction (AGT.1):
   *   Dr Agent commission / Cr Accounts payable — agents (the agent)
   * accepted kg × the purchase's commission per kg. Nothing for a lot with
   * no weight (pieces, crates) or no rate; never twice for one lot.
   */
  async accrueLotCommissionWithClient(client: PoolClient, tenantId: string, actorUserId: string, input: LotCommissionInput): Promise<string | null> {
    const commission = agentCommission(input.acceptedQuantity, input.uom, input.ratePerKg);
    if (!commission) return null;
    if (await this.repo.commissionOfLotWithClient(client, input.lotId)) return null;
    await this.repo.lockAgentWithClient(client, input.agentId);
    const id = randomUUID();
    const entryId = await this.ledger.postWithClient(client, {
      tenantId,
      entryType: 'agent_commission_accrued',
      sourceType: 'agent_commission',
      sourceId: id,
      occurredAt: input.gradedAt,
      memo: `Commission to ${input.agentName}: ${commission.kg} kg accepted × ₹${input.ratePerKg}/kg`,
      createdBy: actorUserId,
      lines: [
        { account: 'agent_commission', debit: commission.amount },
        { account: 'accounts_payable_agent', party: { type: 'agent', id: input.agentId }, credit: commission.amount },
      ],
    });
    await this.repo.insertCommissionWithClient(client, {
      id,
      tenantId,
      agentId: input.agentId,
      lotId: input.lotId,
      purchaseOrderId: input.purchaseOrderId,
      acceptedKg: commission.kg,
      ratePerKg: input.ratePerKg,
      amount: commission.amount,
      accruedAt: input.gradedAt,
      entryId,
      createdBy: actorUserId,
    });
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'create',
      entityType: 'agent_commission',
      entityId: id,
      after: { ...input, acceptedKg: commission.kg, amount: commission.amount },
    });
    return id;
  }

  listAccounts(tenantId: string): Promise<AgentAccount[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.accountsWithClient(client));
  }

  getAccount(tenantId: string, agentId: string): Promise<AgentAccount> {
    return this.db.withTenant(tenantId, async (client) => {
      const account = await this.repo.accountWithClient(client, agentId);
      if (!account) throw new NotFoundException('Agent not found');
      return {
        ...account,
        commissions: await this.repo.commissionsWithClient(client, agentId),
        payments: await this.repo.paymentsWithClient(client, agentId),
      };
    });
  }

  /**
   * Settles commission owed (AGT.2):
   *   Dr Accounts payable — agents (the agent)  amount
   *   Cr Bank / Cash on hand                    amount − TDS
   *   Cr TDS payable                            TDS, when a section is chosen
   * The deduction lands in the TDS register for the quarter's return.
   */
  recordPayment(
    tenantId: string,
    actorUserId: string,
    agentId: string,
    dto: { amount: number; method: PaymentMethod; reference?: string; paidAt?: string; tdsSectionCode?: string },
  ): Promise<AgentPaymentRecord> {
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) throw new BadRequestException('paidAt cannot be in the future');
    const amount = moneyFromNumber(dto.amount);
    if (!isPositiveMoney(amount)) throw new BadRequestException('amount must be more than ₹0');

    return this.db.withTenant(tenantId, async (client) => {
      await this.repo.lockAgentWithClient(client, agentId);
      const account = await this.repo.accountWithClient(client, agentId);
      if (!account) throw new NotFoundException('Agent not found');
      if (compareMoney(amount, account.owed) > 0) {
        throw new ConflictException(`Only ₹${account.owed} of commission is owed to ${account.name}`);
      }
      const paidOn = await this.repo.localDateWithClient(client, paidAt);

      let tds = '0.00';
      let section: Awaited<ReturnType<TaxRulesRepository['tdsSection']>> = null;
      let deducteeType: DeducteeType = 'no_pan';
      let rate = '0';
      if (dto.tdsSectionCode?.trim()) {
        section = await this.taxRulesRepo.tdsSection(client, dto.tdsSectionCode.trim(), paidOn);
        if (!section) throw new BadRequestException(`There is no TDS section ${dto.tdsSectionCode.trim()} in force on ${paidOn}`);
        deducteeType = account.pan ? deducteeTypeFromPan(account.pan) : 'no_pan';
        rate = deducteeType === 'no_pan' ? section.rateNoPan : deducteeType === 'individual_huf' ? section.rateIndividual : section.rateOther;
        tds = percentOfMoney(amount, rate);
        if (!isPositiveMoney(tds)) throw new BadRequestException(`At ${rate}% there is no tax to withhold on ₹${amount}`);
      }
      const net = subtractMoney(amount, tds);
      const id = randomUUID();
      const reference = dto.reference?.trim() || null;
      const entryId = await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'agent_paid',
        sourceType: 'agent_payment',
        sourceId: id,
        occurredAt: paidAt,
        memo: `Commission paid to ${account.name} (${dto.method}${reference ? `, ${reference}` : ''})${section ? ` — TDS ${tds} under ${section.code}` : ''}`,
        createdBy: actorUserId,
        lines: [
          { account: 'accounts_payable_agent', party: { type: 'agent', id: agentId }, debit: amount },
          { account: receivingAccount(dto.method), credit: net },
          { account: 'tds_payable', credit: tds },
        ],
      });
      await this.repo.insertPaymentWithClient(client, {
        id,
        tenantId,
        agentId,
        amount,
        tdsSection: section?.code ?? null,
        tdsAmount: tds,
        method: dto.method,
        reference,
        paidAt,
        entryId,
        createdBy: actorUserId,
      });
      if (section) {
        await this.taxRules.recordDeductionWithClient(client, {
          tenantId,
          sectionId: section.id,
          sectionCode: section.code,
          farmerId: null,
          payeeName: account.name,
          payeePan: account.pan,
          deducteeType,
          baseAmount: amount,
          grossAmount: amount,
          rate,
          tdsAmount: tds,
          deductedOn: paidOn,
          payableId: null,
          sourceType: 'agent_payment',
          sourceId: id,
          ledgerEntryId: entryId,
          createdBy: actorUserId,
        });
      }
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'agent_payment',
        entityId: id,
        after: { agentId, amount, tds, net, method: dto.method, section: section?.code ?? null },
      });
      return (await this.repo.findPaymentWithClient(client, id)) as AgentPaymentRecord;
    });
  }
}
