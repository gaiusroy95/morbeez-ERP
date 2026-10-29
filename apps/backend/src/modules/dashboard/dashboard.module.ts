import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './repositories/dashboard.repository';
import { AccountingModule } from '../accounting/accounting.module';

// Not a bounded context — a read model over several (System Architecture
// DB.4). It owns no tables and never writes; see DashboardRepository for
// why reading across schemas directly is acceptable here and nowhere else.
// Profit & Insights and the Finance hub take their period figures from
// Accounting's profit and loss, so the screens and the books agree.
@Module({
  imports: [AccountingModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
