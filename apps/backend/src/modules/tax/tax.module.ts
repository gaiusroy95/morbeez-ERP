import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { TaxRulesModule } from '../tax-rules/tax-rules.module';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TaxRepository } from './repositories/tax.repository';

// Bounded context: Tax (India) — GST registration and effective-dated
// rates by HSN/SAC, the tax details of products, customers, and farmers,
// the GST invoice register and GSTR-1 / GSTR-3B data, TDS deductions and
// deposits, and e-invoice readiness and IRN records. Owns the tax schema
// (the rules engine, TaxRulesModule, holds its writes for invoices and
// payables). Posts to Finance's ledger only through LedgerService.
@Module({
  imports: [TaxRulesModule, FinanceModule],
  controllers: [TaxController],
  providers: [TaxService, TaxRepository],
  exports: [TaxService],
})
export class TaxModule {}
