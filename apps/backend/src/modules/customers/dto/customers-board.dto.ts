import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CustomersBoardQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'active', 'credit', 'overdue'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'active', 'credit', 'overdue'])
  filter?: 'all' | 'active' | 'credit' | 'overdue';

  @ApiPropertyOptional({ description: 'Only customers on this route' })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ description: 'Name, mobile, place or route' })
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
