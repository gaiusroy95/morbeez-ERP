import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { DriverRequestsService } from './driver-requests.service';
import { DriverRequest } from './driver-requests.entity';
import { CreateDriverRequestDto, DecideDriverRequestDto, ListDriverRequestsQueryDto } from './driver-requests.dto';

// A driver makes and reads their own requests (logistics:write and :read,
// like their chat); the owner reads everyone's from the Approvals inbox.
// Deciding one needs what doing it needs — payroll:prepare for an advance,
// customers:write for a new customer, customers:credit for a limit —
// checked per request in the service.
@ApiTags('driver-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('driver-requests')
export class DriverRequestsController {
  constructor(private readonly requests: DriverRequestsService) {}

  @Get('mine')
  @RequirePermissions('logistics:read')
  mine(@CurrentUser() user: AuthContext): Promise<DriverRequest[]> {
    return this.requests.mine(user.tenantId, user.userId);
  }

  @Post('mine')
  @RequirePermissions('logistics:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateDriverRequestDto): Promise<DriverRequest> {
    return this.requests.create(user.tenantId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('dashboard:read')
  list(@CurrentUser() user: AuthContext, @Query() q: ListDriverRequestsQueryDto): Promise<DriverRequest[]> {
    return this.requests.list(user.tenantId, q.status);
  }

  @Get(':id')
  @RequirePermissions('dashboard:read')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<DriverRequest> {
    return this.requests.get(user.tenantId, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('dashboard:read')
  decide(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDriverRequestDto): Promise<DriverRequest> {
    return this.requests.decide({ tenantId: user.tenantId, userId: user.userId, permissions: user.permissions }, id, dto);
  }
}
