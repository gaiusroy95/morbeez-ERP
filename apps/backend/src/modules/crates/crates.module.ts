import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CratesController } from './crates.controller';
import { CratesService } from './crates.service';
import { CratesRepository } from './repositories/crates.repository';

// Crate management: the business's returnable crates — with customers,
// farmers, vehicles and in the yard — as a ledger of movements, with lost
// crates charged through Finance (an invoice, or a deduction from what a
// farmer is owed).
@Module({
  imports: [FinanceModule],
  controllers: [CratesController],
  providers: [CratesService, CratesRepository],
  exports: [CratesService],
})
export class CratesModule {}
