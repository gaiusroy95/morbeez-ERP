import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { ApprovalsService } from './approvals.service';
import { UpsertApprovalRuleDto } from './dto/upsert-approval-rule.dto';
import { UpsertApprovalLimitDto } from './dto/upsert-approval-limit.dto';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { DecideApprovalRequestDto } from './dto/decide-approval-request.dto';
import { CancelApprovalRequestDto } from './dto/cancel-approval-request.dto';
import {
  ApprovalEvaluation,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
  ApprovalRoleLimitRecord,
  ApprovalRuleRecord,
} from './entities/approval.entity';

@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // ---- Rules: configuring what needs approval ----

  @Get('approval-rules')
  @RequirePermissions('approvals:read')
  listRules(@CurrentUser() user: AuthContext): Promise<ApprovalRuleRecord[]> {
    return this.approvalsService.listRules(user.tenantId);
  }

  @Post('approval-rules')
  @RequirePermissions('approvals:manage')
  upsertRule(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpsertApprovalRuleDto,
  ): Promise<ApprovalRuleRecord> {
    return this.approvalsService.upsertRule(user.tenantId, user.userId, dto);
  }

  // ---- Limits: configuring who can approve how much ----

  @Get('approval-limits')
  @RequirePermissions('approvals:read')
  listLimits(@CurrentUser() user: AuthContext): Promise<ApprovalRoleLimitRecord[]> {
    return this.approvalsService.listLimits(user.tenantId);
  }

  @Post('approval-limits')
  @RequirePermissions('approvals:manage')
  upsertLimit(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpsertApprovalLimitDto,
  ): Promise<ApprovalRoleLimitRecord> {
    return this.approvalsService.upsertLimit(user.tenantId, user.userId, dto);
  }

  // ---- Requests: no static permission gate — any authenticated user can
  // ask "does this need approval," and decide()/cancel() are governed by
  // dynamic checks (role+limit+delegation, or "you filed this"), not RBAC.

  @Get('approval-requests')
  listRequests(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
    @Query('status') status?: ApprovalRequestStatus,
  ): Promise<PaginatedResult<ApprovalRequestRecord>> {
    return this.approvalsService.listRequests(
      user.tenantId,
      status,
      query.page ?? 1,
      query.pageSize ?? 25,
    );
  }

  @Get('approval-requests/:id')
  getRequest(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ): Promise<ApprovalRequestRecord> {
    return this.approvalsService.getRequest(user.tenantId, id);
  }

  @Post('approval-requests')
  evaluate(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateApprovalRequestDto,
  ): Promise<ApprovalEvaluation> {
    return this.approvalsService.evaluate(user.tenantId, user.userId, dto);
  }

  @Post('approval-requests/:id/approve')
  approve(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: DecideApprovalRequestDto,
  ): Promise<ApprovalRequestRecord> {
    return this.approvalsService.decide(user.tenantId, user.userId, id, dto.version, true, dto.note);
  }

  @Post('approval-requests/:id/reject')
  reject(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: DecideApprovalRequestDto,
  ): Promise<ApprovalRequestRecord> {
    return this.approvalsService.decide(user.tenantId, user.userId, id, dto.version, false, dto.note);
  }

  @Post('approval-requests/:id/cancel')
  cancel(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: CancelApprovalRequestDto,
  ): Promise<ApprovalRequestRecord> {
    return this.approvalsService.cancel(user.tenantId, user.userId, id, dto.version);
  }
}
