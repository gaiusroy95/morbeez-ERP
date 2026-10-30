import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { CollectionMethod } from '../entities/customer-collection.entity';

const VALID_METHODS: CollectionMethod[] = ['cash', 'upi', 'bank_transfer', 'cheque'];

export class RecordCollectionDto {
  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ enum: VALID_METHODS })
  @IsIn(VALID_METHODS)
  method!: CollectionMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'UPI or transfer: its reference (UTR)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @ApiPropertyOptional({ enum: ['customer', 'third_party'], description: 'Who paid: the customer, or someone on their behalf (driver app D4)' })
  @IsOptional()
  @IsIn(['customer', 'third_party'])
  payer?: 'customer' | 'third_party';

  @ApiPropertyOptional({ description: 'Paid by someone else: who' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  payerName?: string;
}
