import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { assertRealDate } from '../../common/period';
import { moneyFromNumber } from '../../common/money';
import { ReceivablesService } from './receivables.service';
import { PayablesService } from './payables.service';
import { OpeningBalancesRepository } from './repositories/opening-balances.repository';
import { OpeningBalanceDto } from './dto/opening-balance.dto';

export interface CustomerOpeningBalance {
  kind: 'customer';
  customerId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: string;
  asOf: string;
  dueDate: string;
}

export interface FarmerOpeningBalance {
  kind: 'farmer';
  farmerId: string;
  payableId: string;
  amount: string;
  /** What an advance the farmer already had covered of it. */
  fromAdvance: string;
  outstanding: string;
  asOf: string;
  dueDate: string;
}

/**
 * Opening balances (the client, 20 Nov 2026): "Both customer farmer need
 * opening balance. If they bring old customer in to that it helps." What a
 * customer owed, or what was owed to a farmer, on the day they came onto
 * Morbeez — entered once, dated that day (today unless the owner says), in
 * an open period, and due on that day unless a due date is given. Recorded
 * at the start of that day so a statement shows it before anything else.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: OpeningBalancesRepository,
    private readonly receivables: ReceivablesService,
    private readonly payables: PayablesService,
  ) {}

  forCustomer(tenantId: string, actorUserId: string, customerId: string, dto: OpeningBalanceDto): Promise<CustomerOpeningBalance> {
    return this.db.withTenant(tenantId, async (client) => {
      const when = await this.dated(client, dto);
      const issued = await this.receivables.issueOpeningBalanceWithClient(client, tenantId, actorUserId, {
        customerId,
        amount: when.amount,
        issuedAt: when.at,
        dueDate: when.dueDate,
        note: when.note,
      });
      return { kind: 'customer', customerId, ...issued, asOf: when.asOf };
    });
  }

  forFarmer(tenantId: string, actorUserId: string, farmerId: string, dto: OpeningBalanceDto): Promise<FarmerOpeningBalance> {
    return this.db.withTenant(tenantId, async (client) => {
      const when = await this.dated(client, dto);
      const owed = await this.payables.openingBalanceWithClient(client, tenantId, actorUserId, {
        farmerId,
        amount: when.amount,
        accruedAt: when.at,
        dueDate: when.dueDate,
        note: when.note,
      });
      return { kind: 'farmer', farmerId, ...owed, asOf: when.asOf, dueDate: when.dueDate };
    });
  }

  /** The amount, the day it stood at and when it is due — checked. */
  private async dated(client: PoolClient, dto: OpeningBalanceDto) {
    const amount = moneyFromNumber(dto.amount);
    const { today, closedThrough } = await this.repo.booksWithClient(client);
    const asOf = dto.asOf ?? today;
    assertRealDate(asOf, 'asOf');
    if (asOf > today) throw new BadRequestException('An opening balance stands at today or an earlier day, not a future one');
    if (closedThrough && asOf <= closedThrough) {
      throw new BadRequestException(`The books are closed through ${closedThrough} — date the opening balance after that, or reopen the period first`);
    }
    const dueDate = dto.dueDate ?? asOf;
    assertRealDate(dueDate, 'dueDate');
    const at = await this.repo.startOfDayWithClient(client, asOf);
    return { amount, asOf, dueDate, at, note: dto.note?.trim() || null };
  }
}
