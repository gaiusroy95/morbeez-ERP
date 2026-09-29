import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { AiActor, AiService } from './ai.service';
import { AiSettings, CustomerProfitReport, RecommendationRecord, RunSummary, Scorecard } from './entities/ai.entity';
import { AiSettingsDto, DecideRecommendationDto, ListRecommendationsQueryDto, ProfitQueryDto } from './dto/ai.dto';
import { PaginatedResult } from '../../common/persistence/pagination';

const actor = (u: AuthContext): AiActor => ({ tenantId: u.tenantId, userId: u.userId, permissions: u.permissions });

// ai:read sees suggestions, their evidence and track record, and can ask
// for fresh ones — computing changes nothing. Deciding a type needs that
// type's ai:decide:* (the owner holds all; delegating one is granting it,
// AI System DR.2). ai:configure sets the knobs. Nothing here acts on a
// suggestion: the owner does that through the ordinary endpoint (DR.3).
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  @RequirePermissions('ai:read')
  settings(@CurrentUser() user: AuthContext): Promise<AiSettings> {
    return this.ai.getSettings(user.tenantId);
  }

  @Put('settings')
  @RequirePermissions('ai:configure')
  saveSettings(@CurrentUser() user: AuthContext, @Body() dto: AiSettingsDto): Promise<AiSettings> {
    return this.ai.saveSettings(user.tenantId, user.userId, dto);
  }

  @Post('runs')
  @RequirePermissions('ai:read')
  run(@CurrentUser() user: AuthContext): Promise<RunSummary> {
    return this.ai.run(actor(user));
  }

  @Get('runs/latest')
  @RequirePermissions('ai:read')
  lastRun(@CurrentUser() user: AuthContext): Promise<RunSummary | null> {
    return this.ai.lastRun(user.tenantId);
  }

  @Get('recommendations')
  @RequirePermissions('ai:read')
  list(@CurrentUser() user: AuthContext, @Query() q: ListRecommendationsQueryDto): Promise<PaginatedResult<RecommendationRecord>> {
    return this.ai.list(actor(user), q);
  }

  @Get('recommendations/:id')
  @RequirePermissions('ai:read')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<RecommendationRecord> {
    return this.ai.get(actor(user), id);
  }

  @Post('recommendations/:id/decision')
  @HttpCode(200)
  @RequirePermissions('ai:read')
  decide(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideRecommendationDto): Promise<RecommendationRecord> {
    return this.ai.decide(actor(user), id, dto);
  }

  @Get('scorecard')
  @RequirePermissions('ai:read')
  scorecard(@CurrentUser() user: AuthContext): Promise<Scorecard> {
    return this.ai.scorecard(actor(user));
  }

  /** What each customer contributed — revenue and costs per customer, so finance data too. */
  @Get('customer-profitability')
  @RequirePermissions('ai:read', 'finance:read')
  profitability(@CurrentUser() user: AuthContext, @Query() q: ProfitQueryDto): Promise<CustomerProfitReport> {
    return this.ai.profitability(actor(user), q.from, q.to);
  }
}
