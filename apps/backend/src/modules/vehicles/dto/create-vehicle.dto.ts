import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';
import { VALID_FUEL_TYPES } from '../entities/vehicle.entity';

export class CreateVehicleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  registrationNumber!: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  capacityKg!: number;

  @ApiProperty({ enum: VALID_FUEL_TYPES })
  @IsIn(VALID_FUEL_TYPES)
  fuelType!: string;

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
