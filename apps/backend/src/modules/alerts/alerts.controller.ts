import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { AlertsService, EveningSummary } from './alerts.service';
import { OwnerAlert } from './alerts.repository';
import { AlertsQueryDto, SummaryQueryDto } from './dto/alerts-query.dto';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @RequirePermissions('dashboard:read')
  list(@CurrentUser() user: AuthContext, @Query() query: AlertsQueryDto): Promise<OwnerAlert[]> {
    return this.alerts.list(user.tenantId, query.unread ?? false, query.limit ?? 50);
  }

  @Get('unread-count')
  @RequirePermissions('dashboard:read')
  unreadCount(@CurrentUser() user: AuthContext): Promise<{ unread: number; critical: number }> {
    return this.alerts.unreadCount(user.tenantId);
  }

  @Get('summary')
  @RequirePermissions('dashboard:read')
  summary(@CurrentUser() user: AuthContext, @Query() query: SummaryQueryDto): Promise<EveningSummary> {
    return this.alerts.summary(user.tenantId, query.date);
  }

  @Post('read-all')
  @HttpCode(200)
  @RequirePermissions('dashboard:read')
  readAll(@CurrentUser() user: AuthContext): Promise<{ marked: number }> {
    return this.alerts.markRead(user.tenantId, user.userId, null);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermissions('dashboard:read')
  read(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<{ marked: number }> {
    return this.alerts.markRead(user.tenantId, user.userId, id);
  }
}
