import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { FinanceCostCategory } from '../entities/finance-engine.entity';

export const FINANCE_COST_CATEGORIES: readonly FinanceCostCategory[] = [
  'bank_charges',
  'interest',
  'payment_fee',
  'loan_processing',
  'other',
];

// A cost of finance the business bears: bank charges, loan interest,
// processing fees. Fees taken out of a specific collection or payment are
// recorded on that payment instead (feeAmount).
export class RecordFinanceCostDto {
  @ApiProperty({ enum: FINANCE_COST_CATEGORIES })
  @IsIn(FINANCE_COST_CATEGORIES)
  category!: FinanceCostCategory;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: ['bank', 'cash_on_hand'] })
  @IsIn(['bank', 'cash_on_hand'])
  paidFrom!: 'bank' | 'cash_on_hand';

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsISO8601()
  incurredAt?: string;
}
