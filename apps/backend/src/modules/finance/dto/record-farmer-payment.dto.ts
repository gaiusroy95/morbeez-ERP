import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../entities/finance-engine.entity';
import { PAYMENT_METHODS } from './record-customer-payment.dto';

/** A lot by its id — or, for what's owed without a lot (an opening balance), the payable's id. Exactly one. */
export class LotAllocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({ description: 'The payable, for an opening balance (no lot)' })
  @IsOptional()
  @IsUUID()
  payableId?: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

// Money paid to a farmer. Without allocations it pays their oldest-graded
// lots first; with them, exactly as given. Anything beyond what's owed is
// an advance against their next lots (Accounting Engine, ADV.1-ADV.2).
export class RecordFarmerPaymentDto {
  @ApiProperty()
  @IsUUID()
  farmerId!: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Transfer charge paid on top — booked as a finance cost' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeAmount?: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'When the money was paid; defaults to now' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @ApiPropertyOptional({ type: [LotAllocationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LotAllocationDto)
  allocations?: LotAllocationDto[];
}
