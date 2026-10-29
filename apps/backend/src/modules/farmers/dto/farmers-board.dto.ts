import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class FarmersBoardQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'active', 'pending'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'active', 'pending'])
  filter?: 'all' | 'active' | 'pending';

  @ApiPropertyOptional({ description: 'Only farmers from this village or town' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  place?: string;

  @ApiPropertyOptional({ description: 'Name, mobile, place or product' })
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

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
