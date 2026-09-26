import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './repositories/dashboard.repository';

// Not a bounded context — a read model over several (System Architecture
// DB.4). It owns no tables and never writes; see DashboardRepository for
// why reading across schemas directly is acceptable here and nowhere else.
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
