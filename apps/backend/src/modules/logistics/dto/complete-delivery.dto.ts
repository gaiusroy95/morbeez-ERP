import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SHORTFALL_REASONS, ShortfallReason } from '../entities/delivery-stop.entity';

/**
 * One order line at the customer: what left the vehicle for it (driver app
 * D0, when it differs from the order), and what the customer end measured
 * (client Q&A, live chicken and eggs): the net weight on the customer's
 * scale for live birds — it settles the sale — or the eggs broken on the way.
 */
export class DeliveryLineMeasureDto {
  @ApiProperty()
  @IsUUID()
  orderLineId!: string;

  @ApiPropertyOptional({ description: 'What actually left the vehicle for this line, when it differs from the order (0: none of it)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  deliveredQuantity?: number;

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

  @ApiPropertyOptional({ enum: SHORTFALL_REASONS, description: 'Delivered less than ordered: why (driver app D3)' })
  @IsOptional()
  @IsIn(SHORTFALL_REASONS)
  shortReason?: ShortfallReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  shortNote?: string;
}

/** Crates of one type at the stop (driver app D3): left with the customer, and taken back. */
export class DeliveryCratesDto {
  @ApiProperty() @IsUUID() crateTypeId!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) dropped!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) collected!: number;
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

  @ApiPropertyOptional({ description: "What the driver scanned at the door: must be this customer's QR" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  qrToken?: string;

  @ApiPropertyOptional({ description: "No QR scanned: why (missing, damaged, …) — it doesn't stop the delivery (the client's answer 5)" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  qrNote?: string;

  @ApiPropertyOptional({
    description: "The driver app's delivery checklist (D3): everything delivered is unloaded. When sent, a line delivered short must say why.",
  })
  @IsOptional()
  @IsBoolean()
  allUnloaded?: boolean;

  @ApiPropertyOptional({ type: [DeliveryCratesDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DeliveryCratesDto)
  crates?: DeliveryCratesDto[];
}
