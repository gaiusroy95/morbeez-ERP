import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FARM_REJECT_REASONS, FarmLineOutcome, FarmMeasure, FarmRejectReason } from '../entities/farm-stop.entity';

/** The farm weighment (client Q&A, live chicken): the net weight per product, as weighed at the farm. */
export class FarmWeightDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Net quantity accepted at the farm and loaded — kg for live birds, pieces for eggs' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10_000_000)
  netQuantity!: number;

  @ApiPropertyOptional({ description: 'Weighed but rejected at the farm; it stays there' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10_000_000)
  rejectedQuantity?: number;

  @ApiPropertyOptional({ description: 'Why it was rejected (quality, damaged, short, …)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

/** One product at a farm stop (driver app D2): accepted and loaded, or rejected with a reason. */
export class FarmLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ enum: ['accepted', 'rejected'] })
  @IsIn(['accepted', 'rejected'])
  outcome!: FarmLineOutcome;

  @ApiPropertyOptional({ description: "Accepted by weight: the net quantity loaded, in the product's unit" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10_000_000)
  netQuantity?: number;

  @ApiPropertyOptional({ enum: ['weight', 'bags'], description: "'bags': the quantity is sacks × kgPerBag (kg products)" })
  @IsOptional()
  @IsIn(['weight', 'bags'])
  measuredBy?: FarmMeasure;

  @ApiPropertyOptional({ description: 'Sacks (bags) packed' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sacks?: number;

  @ApiPropertyOptional({ description: 'Counted in bags: kg in each' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10_000)
  kgPerBag?: number;

  @ApiPropertyOptional({ description: 'Weighed and refused (it stays at the farm)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10_000_000)
  rejectedQuantity?: number;

  @ApiPropertyOptional({ enum: FARM_REJECT_REASONS, description: 'Why it was rejected (required when rejected)' })
  @IsOptional()
  @IsIn(FARM_REJECT_REASONS)
  reason?: FarmRejectReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CompletePickupStopDto {
  @ApiPropertyOptional({ type: [FarmWeightDto], description: "What was weighed at the farm; receives the goods on the pickup's purchase order" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FarmWeightDto)
  weights?: FarmWeightDto[];

  @ApiPropertyOptional({
    type: [FarmLineDto],
    description: "The farm stop product by product (driver app D2): every product of the purchase order, accepted or rejected. Replaces 'weights'.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FarmLineDto)
  lines?: FarmLineDto[];

  @ApiPropertyOptional({ description: "Who packed: one of the business's workers" })
  @IsOptional()
  @IsUUID()
  packerEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Who loaded (may be the packer)' })
  @IsOptional()
  @IsUUID()
  loaderEmployeeId?: string;
}
