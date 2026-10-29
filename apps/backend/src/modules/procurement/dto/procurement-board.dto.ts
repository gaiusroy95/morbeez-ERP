import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Max, Min, MinLength } from 'class-validator';

export class ProcurementBoardQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'tomorrow', 'all'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'tomorrow', 'all'])
  day?: 'today' | 'tomorrow' | 'all';

  @ApiPropertyOptional({ description: 'Farmer, place, product or P-number' })
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

export class CreateAgentDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9+ -]{6,20}$/, { message: 'phone looks wrong' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Commission per kg used by default on new orders' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultCommissionPerKg?: number;
}
