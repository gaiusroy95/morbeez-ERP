import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '../entities/finance-engine.entity';
import { PAYMENT_METHODS } from './record-customer-payment.dto';

// Commission paid to an agent (AGT.2): no more than they're owed. TDS is
// withheld only when a section is given — 194H for commission, which only
// payers liable to tax audit must deduct.
export class RecordAgentPaymentDto {
  @ApiProperty({ minimum: 0.01, description: 'Commission settled (₹), before any TDS' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @ApiPropertyOptional({ description: 'UTR, cheque number' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ description: 'When it was paid (default now)' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @ApiPropertyOptional({ example: '194H', description: 'Withhold TDS under this section' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  tdsSectionCode?: string;
}
