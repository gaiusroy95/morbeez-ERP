import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { moneyFromNumber, sumMoney } from '../../common/money';
import { LedgerRepository } from './repositories/ledger.repository';
import { FinanceCostsRepository } from './repositories/finance-costs.repository';
import { ResolvedRange } from './repositories/finance.repository';
import {
  FinanceCostCategory,
  FinanceCostRecord,
  FinanceCostsReport,
} from './entities/finance-engine.entity';
import { RecordFinanceCostDto } from './dto/record-finance-cost.dto';

const COST_ENTITY = 'finance_cost';
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** What finance costs the business — bank charges, interest, fees. */
@Injectable()
export class FinanceCostsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly costs: FinanceCostsRepository,
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditService,
  ) {}

  /**   Dr Finance costs / Cr Bank or Cash on hand */
  async record(tenantId: string, actorUserId: string, dto: RecordFinanceCostDto): Promise<FinanceCostRecord> {
    const incurredAt = dto.incurredAt ? new Date(dto.incurredAt) : new Date();
    if (incurredAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('incurredAt cannot be in the future');
    }
    const amount = moneyFromNumber(dto.amount);

    return this.db.withTenant(tenantId, async (client) => {
      const cost = await this.costs.insertWithClient(client, {
        tenantId,
        category: dto.category,
        amount,
        paidFrom: dto.paidFrom,
        description: dto.description,
        reference: dto.reference ?? null,
        incurredAt,
        recordedBy: actorUserId,
      });
      await this.ledger.postWithClient(client, {
        tenantId,
        entryType: 'finance_cost_recorded',
        sourceType: COST_ENTITY,
        sourceId: cost.id,
        occurredAt: incurredAt,
        memo: `${dto.category.replace(/_/g, ' ')}: ${dto.description}`,
        createdBy: actorUserId,
        lines: [
          { account: 'finance_costs', debit: amount },
          { account: dto.paidFrom, credit: amount },
        ],
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: COST_ENTITY,
        entityId: cost.id,
        after: cost as unknown as Record<string, unknown>,
      });
      return cost;
    });
  }

  report(tenantId: string, range: ResolvedRange): Promise<FinanceCostsReport> {
    return this.db.withTenant(tenantId, async (client) => {
      const items = await this.costs.linesWithClient(client, range.startAt, range.endAt);
      const categories = [...new Set(items.map((i) => i.category))] as FinanceCostCategory[];
      return {
        currency: range.currency,
        from: range.fromDate,
        to: range.toDate,
        total: sumMoney(items.map((i) => i.amount)),
        byCategory: categories
          .map((category) => ({
            category,
            amount: sumMoney(items.filter((i) => i.category === category).map((i) => i.amount)),
          }))
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
        items,
      };
    });
  }
}
