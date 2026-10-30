import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { DevicesService } from './devices.service';
import { SyncReportDto } from './devices.dto';
import { SyncStatus } from './devices.entity';

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** The driver app, after each sync pass: what's still on this phone and what was refused. */
  @Post('sync-report')
  @HttpCode(200)
  @RequirePermissions('logistics:read')
  report(@CurrentUser() user: AuthContext, @Body() dto: SyncReportDto): Promise<{ received: true }> {
    return this.devices.report(user.tenantId, user.userId, dto);
  }

  /** Whoever plans trips: every driver's phone, as it last reported. */
  @Get('sync-status')
  @RequirePermissions('logistics:dispatch')
  status(@CurrentUser() user: AuthContext): Promise<SyncStatus> {
    return this.devices.status(user.tenantId);
  }
}
