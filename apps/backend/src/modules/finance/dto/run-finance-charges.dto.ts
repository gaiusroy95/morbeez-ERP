import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class RunFinanceChargesDto {
  @ApiPropertyOptional({ example: '2026-09-30', description: 'Accrue up to this tenant-local date; defaults to today' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOf must be a date in YYYY-MM-DD form' })
  asOf?: string;
}

export class AsOfQueryDto {
  @ApiPropertyOptional({ example: '2026-09-30', description: 'Tenant-local date; defaults to today' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOf must be a date in YYYY-MM-DD form' })
  asOf?: string;
}
