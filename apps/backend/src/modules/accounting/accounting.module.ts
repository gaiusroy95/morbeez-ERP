import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

// Bounded context: Accounting
// Owns its own schema (database/schemas/) and communicates with other
// modules only through published events or public APIs (Constitution I.3-I.4).
@Module({
  imports: [],
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
