import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { DashboardService } from './dashboard.service';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { DashboardAlerts, DashboardKpis, DashboardOperations, DashboardProfit } from './entities/dashboard.entity';

// Four endpoints, not one combined payload, so the owner app can load and
// fail each panel independently — and so profit can sit behind its own
// permission without the rest of the dashboard needing it.
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  @RequirePermissions('dashboard:read')
  getKpis(@CurrentUser() user: AuthContext, @Query() query: PeriodQueryDto): Promise<DashboardKpis> {
    return this.dashboardService.getKpis(user.tenantId, query);
  }

  @Get('profit')
  @RequirePermissions('dashboard:profit')
  getProfit(@CurrentUser() user: AuthContext, @Query() query: PeriodQueryDto): Promise<DashboardProfit> {
    return this.dashboardService.getProfit(user.tenantId, query);
  }

  @Get('alerts')
  @RequirePermissions('dashboard:read')
  getAlerts(@CurrentUser() user: AuthContext): Promise<DashboardAlerts> {
    return this.dashboardService.getAlerts(user.tenantId);
  }

  @Get('operations')
  @RequirePermissions('dashboard:read')
  getOperations(@CurrentUser() user: AuthContext): Promise<DashboardOperations> {
    return this.dashboardService.getOperations(user.tenantId);
  }
}
