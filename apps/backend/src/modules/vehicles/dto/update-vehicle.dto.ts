import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { VALID_FUEL_TYPES } from '../entities/vehicle.entity';

export class UpdateVehicleDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  capacityKg?: number;

  @ApiPropertyOptional({ enum: VALID_FUEL_TYPES })
  @IsOptional()
  @IsIn(VALID_FUEL_TYPES)
  fuelType?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  acquisitionCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  acquisitionDate?: string;
}
