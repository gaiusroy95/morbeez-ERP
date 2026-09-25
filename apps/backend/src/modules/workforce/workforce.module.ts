import { Module } from '@nestjs/common';
import { WorkforceController } from './workforce.controller';
import { WorkforceService } from './workforce.service';
import { EmployeesRepository } from './repositories/employees.repository';

// Bounded context: Workforce — who works for the tenant, and in what
// capacity; not the same thing as being able to log in (Domain Model,
// Trading Partners & Catalog tier). Owns trading_partners.employee, and
// reads (never writes) identity.app_user to validate an optional
// employee->login link.
@Module({
  controllers: [WorkforceController],
  providers: [WorkforceService, EmployeesRepository],
  exports: [WorkforceService],
})
export class WorkforceModule {}
