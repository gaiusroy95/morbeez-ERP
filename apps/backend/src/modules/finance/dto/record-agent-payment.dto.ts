import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '../entities/finance-engine.entity';
import { PAYMENT_METHODS } from './record-customer-payment.dto';

// Commission paid to an agent (AGT.2): no more than they're owed. No TDS —
// the client confirmed it doesn't apply to agent commission (10 Nov 2026).
export class RecordAgentPaymentDto {
  @ApiProperty({ minimum: 0.01, description: 'Commission settled (₹)' })
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
}
