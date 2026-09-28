import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { SettlementMethod } from '../entities/farmer-settlement.entity';

const VALID_METHODS: SettlementMethod[] = ['cash', 'bank_transfer', 'upi', 'cheque'];

// Pays one lot through Finance (a farmer payment allocated to this lot;
// anything beyond what's owed becomes an advance). No version field: a
// payment is recorded once, never updated. POST /finance/farmer-payments
// pays several lots at once.
export class SettleFarmerDto {
  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ enum: VALID_METHODS })
  @IsIn(VALID_METHODS)
  method!: SettlementMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
