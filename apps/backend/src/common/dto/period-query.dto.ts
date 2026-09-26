import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Calendar dates in the tenant's own timezone (tenant.tenant.timezone), not
// UTC — "today" for a Mumbai wholesaler starts at local midnight. `to`
// defaults to today; `from` defaults to `days` days ending on `to` (30
// unless given). A client asking for "the last 7 days" sends days=7 rather
// than computing dates in the browser's own timezone.
export class PeriodQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 366, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be a date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be a date in YYYY-MM-DD form' })
  to?: string;
}
