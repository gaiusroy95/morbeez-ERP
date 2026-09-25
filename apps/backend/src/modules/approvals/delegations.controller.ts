import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { DelegationsService } from './delegations.service';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { ApprovalDelegationRecord } from './entities/approval.entity';

// No PermissionsGuard here — who can create or revoke a delegation is a
// dynamic question (do you hold the role you're delegating; are you the
// delegator or an approvals:manage holder), resolved inside
// DelegationsService, not a static RBAC gate.
@ApiTags('approval-delegations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('approval-delegations')
export class DelegationsController {
  constructor(private readonly delegationsService: DelegationsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext): Promise<ApprovalDelegationRecord[]> {
    return this.delegationsService.list(user.tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateDelegationDto,
  ): Promise<ApprovalDelegationRecord> {
    return this.delegationsService.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/revoke')
  revoke(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ): Promise<ApprovalDelegationRecord> {
    const isApprovalsManager = user.permissions.includes('approvals:manage');
    return this.delegationsService.revoke(user.tenantId, user.userId, isApprovalsManager, id);
  }
}
