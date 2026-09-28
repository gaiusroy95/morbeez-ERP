import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'must be a date in YYYY-MM-DD form' };

// Formats are checked here; GSTIN check characters and state codes by the
// service (for a message that says what's wrong), and again by the tax
// tables' own CHECKs.

export class UpdateTaxProfileDto {
  @ApiProperty({ description: '0 when saving for the first time' })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ enum: ['regular', 'composition', 'unregistered'] })
  @IsIn(['regular', 'composition', 'unregistered'])
  registrationType!: 'regular' | 'composition' | 'unregistered';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) tradeName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) addressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[1-9][0-9]{5}$/, { message: 'pincode must be 6 digits' }) pincode?: string;
  @ApiPropertyOptional({ description: 'Needed when unregistered; taken from the GSTIN otherwise' })
  @IsOptional()
  @Matches(/^[0-9]{2}$/, { message: 'stateCode must be a 2-digit GST state code' })
  stateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) pan?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) tan?: string;

  @ApiProperty({ enum: [4, 6, 8] })
  @IsIn([4, 6, 8])
  hsnMinDigits!: 4 | 6 | 8;

  @ApiProperty({ description: 'Inter-state B2C invoices above this are reported one by one (B2CL)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  b2clThreshold!: number;

  @ApiProperty() @IsBoolean() einvoiceEnabled!: boolean;

  @ApiPropertyOptional({ description: 'Days within which an invoice must be registered on the IRP, if a limit applies' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  einvoiceReportWithinDays?: number | null;

  @ApiPropertyOptional({ description: 'TDS section applied to farmer purchases; empty for none' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  farmerTdsSection?: string | null;
}

export class CreateGstRateDto {
  @ApiProperty({ description: 'HSN (goods) or SAC (services), 2–8 digits; a shorter code covers every longer one under it' })
  @Matches(/^[0-9]{2,8}$/, { message: 'hsnCode must be 2 to 8 digits' })
  hsnCode!: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) description!: string;

  @ApiProperty({ enum: ['goods', 'services'] }) @IsIn(['goods', 'services']) supplyKind!: 'goods' | 'services';

  @ApiProperty({ enum: ['taxable', 'nil_rated', 'exempt', 'non_gst'] })
  @IsIn(['taxable', 'nil_rated', 'exempt', 'non_gst'])
  taxability!: 'taxable' | 'nil_rated' | 'exempt' | 'non_gst';

  @ApiProperty({ description: 'Total GST %, split CGST/SGST or charged as IGST' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate!: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(400) cessRate?: number;

  @ApiProperty() @Matches(ISO_DATE, DATE_MESSAGE) effectiveFrom!: string;
}

export class CreateTdsSectionDto {
  @ApiProperty() @Matches(/^[0-9A-Za-z()/.-]{2,20}$/, { message: 'code may use letters, digits and ( ) / . -' }) code!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) description!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) rateIndividual!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) rateOther!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) rateNoPan!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) singleThreshold?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) annualThreshold?: number | null;
  @ApiProperty({ enum: ['excess_over_annual', 'full_once_crossed'] })
  @IsIn(['excess_over_annual', 'full_once_crossed'])
  basis!: 'excess_over_annual' | 'full_once_crossed';
  @ApiProperty() @Matches(ISO_DATE, DATE_MESSAGE) effectiveFrom!: string;
}

export class EndRuleDto {
  @ApiProperty({ description: 'Last day the rule applies' })
  @Matches(ISO_DATE, DATE_MESSAGE)
  effectiveTo!: string;
}

export class SetProductTaxDto {
  @ApiProperty() @Matches(/^[0-9]{4,8}$/, { message: 'An HSN code on a product is 4 to 8 digits' }) hsnCode!: string;
}

export class SetCustomerTaxDto {
  @ApiPropertyOptional({ description: 'Empty for an unregistered customer' }) @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @ApiPropertyOptional({ description: 'Required without a GSTIN; taken from it otherwise' })
  @IsOptional()
  @Matches(/^[0-9]{2}$/, { message: 'stateCode must be a 2-digit GST state code' })
  stateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[1-9][0-9]{5}$/, { message: 'pincode must be 6 digits' }) pincode?: string;
}

export class SetFarmerTaxDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) pan?: string;
  @ApiPropertyOptional({ enum: ['individual_huf', 'other'], description: 'Omit to read it from the PAN' })
  @IsOptional()
  @IsIn(['individual_huf', 'other'])
  deducteeType?: 'individual_huf' | 'other' | null;
  @ApiProperty() @IsBoolean() tdsExempt!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) exemptReason?: string;
}

export class RangeQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE_MESSAGE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE_MESSAGE) to!: string;
}

export class QuarterQueryDto {
  @ApiProperty({ example: '2026-27' }) @Matches(/^\d{4}-\d{2}$/, { message: 'fy must look like 2026-27' }) fy!: string;
  @ApiProperty({ enum: [1, 2, 3, 4] }) @Type(() => Number) @IsIn([1, 2, 3, 4]) quarter!: 1 | 2 | 3 | 4;
}

/**
 * A payment on which TDS is withheld — rent, a transport contractor, a
 * professional's fee. The expense is booked gross, the payee paid net,
 * and the difference owed to the government.
 */
export class RecordTdsDeductionDto {
  @ApiProperty() @IsString() @MaxLength(20) sectionCode!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) payeeName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) pan?: string;
  @ApiPropertyOptional({ enum: ['individual_huf', 'other'] }) @IsOptional() @IsIn(['individual_huf', 'other']) deducteeType?: 'individual_huf' | 'other';
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) grossAmount!: number;
  @ApiProperty() @Matches(ISO_DATE, DATE_MESSAGE) date!: string;
  @ApiProperty({ description: 'The expense account the gross amount is booked to' })
  @Matches(/^[a-z][a-z0-9_]{1,62}$/)
  expenseAccountCode!: string;
  @ApiProperty({ enum: ['bank', 'cash_on_hand'] }) @IsIn(['bank', 'cash_on_hand']) paidFrom!: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class RecordTdsChallanDto {
  @ApiProperty() @IsString() @MaxLength(20) sectionCode!: string;
  @ApiProperty({ type: [String] })
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  deductionIds!: string[];
  @ApiPropertyOptional({ description: 'Interest for late deposit' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  interest?: number;
  @ApiProperty() @Matches(ISO_DATE, DATE_MESSAGE) paidOn!: string;
  @ApiProperty() @Matches(/^[0-9]{7}$/, { message: 'BSR code is 7 digits' }) bsrCode!: string;
  @ApiProperty() @Matches(/^[0-9]{5}$/, { message: 'Challan serial number is 5 digits' }) challanSerial!: string;
  @ApiProperty({ enum: ['bank', 'cash_on_hand'] }) @IsIn(['bank', 'cash_on_hand']) paidFrom!: 'bank' | 'cash_on_hand';
}

export class RecordIrnDto {
  @ApiProperty({ description: '64-character Invoice Reference Number from the IRP' })
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'An IRN is 64 hexadecimal characters' })
  irn!: string;
  @ApiProperty() @Matches(/^[0-9]{1,20}$/, { message: 'The acknowledgement number is digits only' }) ackNo!: string;
  @ApiProperty({ description: 'Acknowledgement date and time, ISO 8601' }) @IsString() ackDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) signedQr?: string;
}

export class CancelIrnDto {
  @ApiProperty({ enum: ['1', '2', '3', '4'], description: '1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other' })
  @IsIn(['1', '2', '3', '4'])
  reasonCode!: '1' | '2' | '3' | '4';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(100) remark!: string;
}
