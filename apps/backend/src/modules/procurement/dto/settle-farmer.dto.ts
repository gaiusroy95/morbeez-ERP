import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { SettlementMethod } from '../entities/farmer-settlement.entity';

const VALID_METHODS: SettlementMethod[] = ['cash', 'bank_transfer', 'upi', 'cheque'];

// No version field — a settlement is created once, never updated
// (money.farmer_settlement has no version column; see the entity comment).
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
