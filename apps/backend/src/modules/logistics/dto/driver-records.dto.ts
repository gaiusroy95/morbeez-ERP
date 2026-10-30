import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The days a driver's expenses or trips are listed for; the last 30 when left out (driver app D6). */
export class DriverRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-30' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;
}

/** My Earnings' period (D7). */
export class EarningsQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month'] })
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';
}
