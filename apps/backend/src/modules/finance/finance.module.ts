import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FarmersModule } from '../farmers/farmers.module';
import { TaxRulesModule } from '../tax-rules/tax-rules.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ReceivablesService } from './receivables.service';
import { PayablesService } from './payables.service';
import { FinanceCostsService } from './finance-costs.service';
import { LedgerService } from './ledger.service';
import { FinanceRepository } from './repositories/finance.repository';
import { LedgerRepository } from './repositories/ledger.repository';
import { ReceivablesRepository } from './repositories/receivables.repository';
import { PayablesRepository } from './repositories/payables.repository';
import { FinanceCostsRepository } from './repositories/finance-costs.repository';

// Bounded context: Finance — the append-only double-entry ledger, invoices,
// collections, payables and payments to farmers, finance charges, and
// finance costs (Domain Model, Finance). Owns money.ledger_*, invoice*,
// customer_payment*, farmer_payable/payment*, finance_charge, finance_cost.
//
// Depends only on Customers (credit policy) and Farmers (payee names).
// Orders, Procurement, and Logistics depend on Finance: they call
// ReceivablesService/PayablesService inside their own transactions when
// goods are delivered, lots are graded, and cash is collected; Logistics and
// Inventory post trip cash and stock write-offs through LedgerService, and
// Accounting posts journals and period closes through it too. Never the
// reverse, so there is no cycle.
@Module({
  imports: [CustomersModule, FarmersModule, TaxRulesModule],
  controllers: [FinanceController],
  providers: [
    FinanceService,
    ReceivablesService,
    PayablesService,
    FinanceCostsService,
    LedgerService,
    FinanceRepository,
    LedgerRepository,
    ReceivablesRepository,
    PayablesRepository,
    FinanceCostsRepository,
  ],
  exports: [ReceivablesService, PayablesService, LedgerService],
})
export class FinanceModule {}
