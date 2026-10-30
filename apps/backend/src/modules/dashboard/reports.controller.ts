import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { ReportsService } from './reports.service';
import { ReportTable } from './entities/report.entity';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be a date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be a date in YYYY-MM-DD form' })
  to?: string;
}

/**
 * Reports (owner app redesign Phase 7). No static permission here: each
 * report needs the permission of the screen its figures come from, checked
 * by ReportsService.
 */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  report(@CurrentUser() user: AuthContext, @Param('kind') kind: string, @Query() q: ReportQueryDto): Promise<ReportTable> {
    return this.reports.report(user.tenantId, user.permissions, kind, q.from, q.to);
  }
}
