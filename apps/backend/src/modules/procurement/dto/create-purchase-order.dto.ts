import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseOrderLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  /** In the product's unit (kg). When bought by the bag, bags × kgPerBag. */
  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  expectedQuantity!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  indicativePrice!: number;

  @ApiPropertyOptional({ description: 'Bought by the bag: how many bags' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  bags?: number;

  @ApiPropertyOptional({ description: 'Kg in one bag' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  kgPerBag?: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty()
  @IsUUID()
  farmerId!: string;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];

  @ApiPropertyOptional({ description: 'The day the produce is picked up (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'pickupDate must be YYYY-MM-DD' })
  pickupDate?: string;

  @ApiPropertyOptional({ description: 'HH:MM, local time' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'pickupTime must be HH:MM' })
  pickupTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'A middleman who brought the produce' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ description: "The agent's commission per kg" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  commissionPerKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Confirm straight away (and schedule the pickup); an order over the approval limit waits for approval instead' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
