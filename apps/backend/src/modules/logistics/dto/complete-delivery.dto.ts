import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * What the customer end measured on one order line (client Q&A, live chicken
 * and eggs): the net weight on the customer's scale for live birds — it
 * settles the sale — or the eggs broken on the way.
 */
export class DeliveryLineMeasureDto {
  @ApiProperty()
  @IsUUID()
  orderLineId!: string;

  @ApiPropertyOptional({ description: 'Live birds: net kg on the customer\'s scale' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  customerWeight?: number;

  @ApiPropertyOptional({ description: 'Eggs: pieces broken on the way' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  brokenQuantity?: number;
}

// signatureData is optional — a 'pod'-type photo already uploaded for this
// stop can satisfy proof on its own; LogisticsService requires at least
// one of the two, not both. recipientName is always required: a delivery
// completed with no record of who received it isn't proof of anything.
export class CompleteDeliveryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  recipientName!: string;

  @ApiPropertyOptional({ description: 'Base64-encoded signature image data' })
  @IsOptional()
  @IsString()
  signatureData?: string;

  @ApiPropertyOptional({ type: [DeliveryLineMeasureDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineMeasureDto)
  lines?: DeliveryLineMeasureDto[];
}
