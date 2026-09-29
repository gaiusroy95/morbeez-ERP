import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { WorkforceController } from './workforce.controller';
import { WorkforceService } from './workforce.service';
import { EmployeesRepository } from './repositories/employees.repository';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRepository } from './repositories/payroll.repository';

// Bounded context: Workforce — who works for the tenant and in what
// capacity (not the same thing as being able to log in, Domain Model),
// what they did (assignments, which are also attendance), and what they
// are paid (pay rates, incentives, the minimum wage, advances, and
// settlements). Owns trading_partners.employee and the workforce schema;
// posts labour cost to Finance's ledger only through LedgerService.
// Logistics calls in when a trip completes, to record its driver's work.
@Module({
  imports: [FinanceModule],
  // PayrollController first: its /workforce/workers, /assignments, … must
  // be matched before WorkforceController's catch-all /workforce/:id.
  controllers: [PayrollController, WorkforceController],
  providers: [WorkforceService, EmployeesRepository, PayrollService, PayrollRepository],
  exports: [WorkforceService, PayrollService],
})
export class WorkforceModule {}
