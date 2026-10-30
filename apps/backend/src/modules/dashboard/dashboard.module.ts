import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './repositories/dashboard.repository';
import { ApprovalsInboxRepository } from './repositories/approvals-inbox.repository';
import { ApprovalsInboxService } from './approvals-inbox.service';
import { ReportsRepository } from './repositories/reports.repository';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AccountingModule } from '../accounting/accounting.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WorkforceModule } from '../workforce/workforce.module';

// Not a bounded context — a read model over several (System Architecture
// DB.4). It owns no tables and never writes; see DashboardRepository for
// why reading across schemas directly is acceptable here and nowhere else.
// Profit & Insights and the Finance hub take their period figures from
// Accounting's profit and loss, so the screens and the books agree. The
// Approvals inbox and the Reports (redesign Phase 7) are read the same way;
// the vehicle and workforce reports come from Fleet's and Payroll's own.
@Module({
  imports: [AccountingModule, VehiclesModule, WorkforceModule],
  controllers: [DashboardController, ReportsController],
  providers: [DashboardService, DashboardRepository, ApprovalsInboxRepository, ApprovalsInboxService, ReportsRepository, ReportsService],
})
export class DashboardModule {}
