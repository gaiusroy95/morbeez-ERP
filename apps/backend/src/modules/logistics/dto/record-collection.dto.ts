import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
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
}
