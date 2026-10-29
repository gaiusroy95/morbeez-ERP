import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RangeName = 'today' | 'week' | 'month' | 'custom';

/**
 * The period tabs on Finance and Profit & Insights (redesign V1.1): today,
 * the last 7 days, this month so far — in the business's own timezone — or
 * the owner's own dates.
 */
export class RangeQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'custom'], default: 'month' })
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'custom'])
  period?: RangeName;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'With period=custom' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be a date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-28', description: 'With period=custom' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be a date in YYYY-MM-DD form' })
  to?: string;
}
