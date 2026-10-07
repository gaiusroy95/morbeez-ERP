import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { EmployeeRecord } from '../workforce/entities/employee.entity';
import { DayOffState, DelegationService, DriverPoolEntry } from './delegation.service';
import { DelegationRecord } from './delegation';
import { GrantDelegationDto, SetEligibilityDto, StartDayOffDto } from './dto/delegation.dto';

// Owner independence (client Q&A 1 Oct 2026, D–E). Seeing the driver pool
// is a dispatcher's view; deciding who may act for the owner — eligibility,
// grants, day-off mode — is the owner's, the same permission that closes
// trips (logistics:reconcile).
@ApiTags('delegation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('delegation')
export class DelegationController {
  constructor(private readonly delegation: DelegationService) {}

  @Get('drivers')
  @RequirePermissions('logistics:dispatch')
  pool(@CurrentUser() user: AuthContext): Promise<DriverPoolEntry[]> {
    return this.delegation.pool(user.tenantId, user.userId);
  }

  @Patch('drivers/:employeeId')
  @RequirePermissions('logistics:reconcile')
  setEligibility(
    @CurrentUser() user: AuthContext,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SetEligibilityDto,
  ): Promise<EmployeeRecord> {
    return this.delegation.setEligibility(user.tenantId, user.userId, employeeId, dto);
  }

  @Get('grants')
  @RequirePermissions('logistics:dispatch')
  recent(@CurrentUser() user: AuthContext) {
    return this.delegation.recent(user.tenantId);
  }

  @Post('grants')
  @RequirePermissions('logistics:reconcile')
  grant(@CurrentUser() user: AuthContext, @Body() dto: GrantDelegationDto): Promise<DelegationRecord> {
    return this.delegation.grant(user.tenantId, user.userId, dto);
  }

  @Post('grants/:id/revoke')
  @HttpCode(200)
  @RequirePermissions('logistics:reconcile')
  revoke(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<DelegationRecord> {
    return this.delegation.revoke(user.tenantId, user.userId, id);
  }

  @Get('day-off')
  @RequirePermissions('logistics:dispatch')
  dayOff(@CurrentUser() user: AuthContext): Promise<DayOffState> {
    return this.delegation.dayOff(user.tenantId);
  }

  @Post('day-off')
  @HttpCode(200)
  @RequirePermissions('logistics:reconcile')
  startDayOff(@CurrentUser() user: AuthContext, @Body() dto: StartDayOffDto): Promise<DayOffState> {
    return this.delegation.startDayOff(user.tenantId, user.userId, dto);
  }

  @Post('day-off/end')
  @HttpCode(200)
  @RequirePermissions('logistics:reconcile')
  endDayOff(@CurrentUser() user: AuthContext): Promise<DayOffState> {
    return this.delegation.endDayOff(user.tenantId, user.userId);
  }
}
