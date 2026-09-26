import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceRepository } from './repositories/finance.repository';

// Bounded context: Finance. For now a read model over collections,
// settlements, trip expenses, and reconciliations (System Architecture
// DB.4) — it owns no tables and never writes; see FinanceRepository.
@Module({
  controllers: [FinanceController],
  providers: [FinanceService, FinanceRepository],
  exports: [FinanceService],
})
export class FinanceModule {}
