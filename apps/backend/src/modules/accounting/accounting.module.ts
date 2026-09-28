import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AccountingRepository } from './repositories/accounting.repository';

// Bounded context: Accounting — the tenant's chart of accounts, manual
// journals, the general ledger, the trial balance, the financial statements
// (P&L, balance sheet, cash flow), and period closing, over Finance's single
// append-only ledger (Accounting Engine). Owns money.account,
// money.manual_journal, and money.period_close; posts to the ledger only
// through Finance's exported LedgerService (Constitution I.3-I.4).
@Module({
  imports: [FinanceModule],
  controllers: [AccountingController],
  providers: [AccountingService, AccountingRepository],
  exports: [AccountingService],
})
export class AccountingModule {}
