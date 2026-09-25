import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './repositories/customers.repository';

// Bounded context: Customers — who the wholesaler sells to (Domain
// Model, Trading Partners tier). DatabaseModule and AuditModule are
// global (infra/database, infra/audit), so no explicit import is needed
// for either (Constitution I.3-I.4).
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
