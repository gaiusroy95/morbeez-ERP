import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class OrdersBoardQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'tomorrow', 'all'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'tomorrow', 'all'])
  day?: 'today' | 'tomorrow' | 'all';

  @ApiPropertyOptional({ description: 'Customer, place, route, product or D-number' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
