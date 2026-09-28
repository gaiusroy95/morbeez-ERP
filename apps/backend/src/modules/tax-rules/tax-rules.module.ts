import { Module } from '@nestjs/common';
import { TaxRulesService } from './tax-rules.service';
import { TaxRulesRepository } from './repositories/tax-rules.repository';

// The tax rules engine: GST on invoices and TDS on payables, from the
// tenant's configured, effective-dated rules. Depends on nothing but the
// database, so Finance can call it inside its own transactions; the Tax
// module (settings, returns, e-invoices, TDS deposits) sits above both.
@Module({
  providers: [TaxRulesService, TaxRulesRepository],
  exports: [TaxRulesService, TaxRulesRepository],
})
export class TaxRulesModule {}
