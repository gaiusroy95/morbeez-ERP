import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';

// Deliberately no `id` or `tenantId` field — which business account gets
// updated is always the caller's own (Constitution IV.2), read from the
// authenticated context in the controller, never accepted here.
export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxRegistration?: string;

  @ApiPropertyOptional({ example: '22:00', description: "When the business's day ends; day-off delegations end here" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'operatingDayEnd is a time like 22:00' })
  operatingDayEnd?: string;

  @ApiPropertyOptional({ description: 'Alert at once when a cash handover is off by at least this (₹)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  alertCashThreshold?: number;

  @ApiPropertyOptional({ description: 'Alert at once when cash customers are short by at least this (₹)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  alertCollectionThreshold?: number;

  @ApiPropertyOptional({ description: 'Live-bird transit shrinkage accepted, % (products may set their own)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultShrinkageTolerancePct?: number;

  @ApiPropertyOptional({ description: 'Egg breakage accepted, % (products may set their own)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultBreakageTolerancePct?: number;

  @ApiPropertyOptional({ enum: ['optional', 'required', 'not_required'], description: "A photo of the customer's scale with a customer-end weight" })
  @IsOptional()
  @IsIn(['optional', 'required', 'not_required'])
  weighmentPhoto?: string;
}
