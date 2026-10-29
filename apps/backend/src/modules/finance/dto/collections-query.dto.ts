import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CollectionsView } from '../entities/collections.entity';

export class CollectionsQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'pending', 'all'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'pending', 'all'])
  view?: CollectionsView;

  @ApiPropertyOptional({ description: 'Customer name, mobile or place' })
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
  @Max(200)
  pageSize?: number;
}
