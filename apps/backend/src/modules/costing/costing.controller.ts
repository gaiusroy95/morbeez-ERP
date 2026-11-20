import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { CostingService } from './costing.service';
import { ContributionLevel, ContributionReport, CostAllocationSettings, TripCostRecord } from './costing.entity';

const LEVELS: ContributionLevel[] = ['business', 'route', 'trip', 'vehicle', 'product', 'customer', 'order'];

export class ContributionQueryDto {
  @ApiProperty({ enum: LEVELS })
  @IsIn(LEVELS)
  level!: ContributionLevel;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-11-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}

export class CostAllocationSettingDto {
  @ApiProperty({ minimum: 0, maximum: 100, description: 'The running pool’s share by KG; the rest by verified service minutes (D1)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  kgSharePct!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// Master Spec v3 P5. Costs are money: reading them is finance:read; changing
// how they're shared, or costing earlier trips, is finance:manage.
@ApiTags('costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('costing')
export class CostingController {
  constructor(private readonly costing: CostingService) {}

  @Get('trips/:id')
  @RequirePermissions('finance:read')
  tripCost(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<TripCostRecord> {
    return this.costing.getTripCost(user.tenantId, id);
  }

  @Get('contribution')
  @RequirePermissions('finance:read')
  contribution(@CurrentUser() user: AuthContext, @Query() q: ContributionQueryDto): Promise<ContributionReport> {
    return this.costing.contribution(user.tenantId, q.level, q.from, q.to);
  }

  @Post('backfill')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  backfill(@CurrentUser() user: AuthContext): Promise<{ costed: number; tripIds: string[] }> {
    return this.costing.backfill(user.tenantId, user.userId);
  }

  @Get('settings')
  @RequirePermissions('finance:read')
  settings(@CurrentUser() user: AuthContext): Promise<CostAllocationSettings> {
    return this.costing.settings(user.tenantId);
  }

  @Put('settings')
  @RequirePermissions('finance:manage')
  setSettings(@CurrentUser() user: AuthContext, @Body() dto: CostAllocationSettingDto): Promise<CostAllocationSettings> {
    return this.costing.setKgShare(user.tenantId, user.userId, dto);
  }
}
