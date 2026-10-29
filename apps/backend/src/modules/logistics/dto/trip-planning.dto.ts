import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class TripsBoardQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'tomorrow', 'all'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'tomorrow', 'all'])
  day?: 'today' | 'tomorrow' | 'all';

  @ApiPropertyOptional({ description: 'Trip number, route, vehicle, driver, customer or farmer' })
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

export class TripPlanQueryDto {
  @ApiProperty({ description: 'The trip date (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ description: 'For its capacity and what is on it now' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
