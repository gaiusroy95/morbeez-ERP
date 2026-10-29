import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class ClosingStockDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 0, description: 'What was counted on the vehicle' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity!: number;
}

export class ReconcileTripDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ minimum: 0, description: 'Cash the owner received from the driver at handover' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cashReturned!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Required when anything checked is an exception (the cash doesn't match,
   * a delivery has no proof, a cash customer didn't pay...): closing then
   * means approving it with this reason on record.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  exceptionNote?: string;

  /**
   * What was counted on the vehicle at closing, product by product (a
   * product left out was counted as none). Checked against what should be
   * there: loaded + picked up − delivered. Left out entirely: not counted.
   */
  @ApiPropertyOptional({ type: [ClosingStockDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ClosingStockDto)
  closingStock?: ClosingStockDto[];
}
