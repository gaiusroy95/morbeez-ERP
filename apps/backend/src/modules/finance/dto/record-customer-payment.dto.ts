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

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'upi', 'bank_transfer', 'cheque'];

export class InvoiceAllocationDto {
  @ApiProperty()
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

// Money received from a customer at the office — UPI, bank transfer,
// cheque, or cash. Without allocations it's applied to their oldest-due
// invoices; with them, exactly as given. Anything left over stays on the
// customer's account and is applied to their next invoice.
export class RecordCustomerPaymentDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ minimum: 0, description: 'What the bank or gateway kept — booked as a finance cost' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeAmount?: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @ApiPropertyOptional({ description: 'UTR, cheque number, or similar' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'When the money was received; defaults to now' })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  @ApiPropertyOptional({ type: [InvoiceAllocationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceAllocationDto)
  allocations?: InvoiceAllocationDto[];
}
