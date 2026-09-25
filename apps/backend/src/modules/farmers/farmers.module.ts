import { Module } from '@nestjs/common';
import { FarmersController } from './farmers.controller';
import { FarmersService } from './farmers.service';
import { FarmersRepository } from './repositories/farmers.repository';

// Bounded context: Farmers — who the wholesaler buys from (Domain Model,
// Trading Partners tier). DatabaseModule and AuditModule are global.
@Module({
  controllers: [FarmersController],
  providers: [FarmersService, FarmersRepository],
  exports: [FarmersService],
})
export class FarmersModule {}
