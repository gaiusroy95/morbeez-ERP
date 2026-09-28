import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

// A customer's credit terms. Changes apply going forward: an invoice's due
// date is fixed when it's issued, so a new paymentTermsDays never re-dates
// one already out.
export class UpdateCreditTermsDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 5, description: 'Percent per 30 days on overdue invoices; 0 turns finance charges off' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  financeChargeRateMonthly?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 90, description: 'Days past due before a finance charge starts' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  financeChargeGraceDays?: number;

  @ApiPropertyOptional({ description: 'While on hold, no new order for this customer can be confirmed' })
  @IsOptional()
  @IsBoolean()
  creditHold?: boolean;

  @ApiPropertyOptional({ description: 'Required when placing a hold' })
  @ValidateIf((dto: UpdateCreditTermsDto) => dto.creditHold === true)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  creditHoldReason?: string;
}
