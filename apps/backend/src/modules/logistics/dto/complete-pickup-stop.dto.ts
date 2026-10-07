import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsPositive, IsUUID, ValidateNested } from 'class-validator';

/** The farm weighment (client Q&A, live chicken): the net weight per product, as weighed at the farm. */
export class FarmWeightDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Net quantity received — kg for live birds, pieces for eggs' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  netQuantity!: number;
}

export class CompletePickupStopDto {
  @ApiPropertyOptional({ type: [FarmWeightDto], description: "What was weighed at the farm; receives the goods on the pickup's purchase order" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FarmWeightDto)
  weights?: FarmWeightDto[];
}
