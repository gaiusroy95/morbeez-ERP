import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE = { message: 'must be a date in YYYY-MM-DD form' };
const MONTH = /^\d{4}-\d{2}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PAID_FROM = ['bank', 'cash_on_hand'] as const;

export class FleetSettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty({ description: 'Warn this many days before a document expires' }) @IsInt() @Min(0) @Max(365) documentReminderDays!: number;
  @ApiProperty({ description: 'Refuse trips on a vehicle with an expired document' }) @IsBoolean() blockTripsOnExpired!: boolean;
}

export class VehicleProfileDto {
  @ApiProperty({ description: '0 when saving for the first time' }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['owned', 'hired'] }) @IsIn(['owned', 'hired']) ownership!: 'owned' | 'hired';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) makeModel?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1950) @Max(2100) manufactureYear?: number | null;
}

export class RecordFuelDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) filledOn!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(10000) litres!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9_999_999) odometerKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) station?: string;
  @ApiProperty({ enum: PAID_FROM }) @IsIn(PAID_FROM) paidFrom!: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsUUID() tripId?: string;
}

export class RecordMaintenanceDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) serviceDate!: string;
  @ApiProperty({ enum: ['service', 'repair', 'tyres', 'battery', 'accident', 'other'] })
  @IsIn(['service', 'repair', 'tyres', 'battery', 'accident', 'other'])
  kind!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) vendor?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9_999_999) odometerKm?: number;
  @ApiProperty({ description: '0 for work under warranty' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount!: number;
  @ApiPropertyOptional({ enum: PAID_FROM, description: 'Required when there is an amount' }) @IsOptional() @IsIn(PAID_FROM) paidFrom?: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) nextDueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(9_999_999) nextDueKm?: number;
}

export class RecordDocumentDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
  @ApiProperty({ enum: ['registration', 'insurance', 'puc', 'fitness', 'permit', 'road_tax', 'other'] })
  @IsIn(['registration', 'insurance', 'puc', 'fitness', 'permit', 'road_tax', 'other'])
  docType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) docNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) issuer?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) validFrom?: string;
  @ApiPropertyOptional({ description: 'Required except for registration and other' }) @IsOptional() @Matches(ISO_DATE, DATE) validUntil?: string;
  @ApiPropertyOptional({ description: 'Premium or fee paid, if any' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number;
  @ApiPropertyOptional({ enum: PAID_FROM }) @IsOptional() @IsIn(PAID_FROM) paidFrom?: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class CapitalizeVehicleDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) capitalizedOn!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) cost!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salvageValue!: number;
  @ApiProperty({ enum: ['straight_line', 'written_down'] }) @IsIn(['straight_line', 'written_down']) method!: 'straight_line' | 'written_down';
  @ApiPropertyOptional({ description: 'Straight line' }) @IsOptional() @IsInt() @Min(1) @Max(600) usefulLifeMonths?: number;
  @ApiPropertyOptional({ description: 'Written-down value, percent a year' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) annualRate?: number;
  @ApiProperty({ enum: ['bank', 'cash_on_hand', 'owner_capital'], description: 'How it was paid for (a loan: record the loan into the bank first, then bank)' })
  @IsIn(['bank', 'cash_on_hand', 'owner_capital'])
  fundedBy!: 'bank' | 'cash_on_hand' | 'owner_capital';
  @ApiPropertyOptional({ description: 'Depreciation already charged before these books began' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAccumulated?: number;
}

export class RunDepreciationDto {
  @ApiProperty({ description: 'The last month to charge, YYYY-MM; it must be over' }) @Matches(MONTH, { message: 'throughMonth must be YYYY-MM' }) throughMonth!: string;
}

export class DisposeVehicleDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) disposedOn!: string;
  @ApiProperty({ enum: ['sold', 'scrapped', 'written_off'] }) @IsIn(['sold', 'scrapped', 'written_off']) method!: 'sold' | 'scrapped' | 'written_off';
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) proceeds!: number;
  @ApiPropertyOptional({ enum: PAID_FROM, description: 'Required when there are proceeds' }) @IsOptional() @IsIn(PAID_FROM) receivedInto?: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) buyer?: string;
}

export class CreateLoanDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) lender!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) principal!: number;
  @ApiProperty({ description: 'Percent a year, reducing balance' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(60) annualRate!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(360) tenureMonths!: number;
  @ApiPropertyOptional({ description: "The lender's EMI, when it differs from the formula" }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) emi?: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) disbursedOn!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) firstEmiOn!: string;
}

export class PayEmiDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) paidOn!: string;
  @ApiPropertyOptional({ description: 'Defaults to the EMI; the last one to what is left' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @ApiProperty({ enum: PAID_FROM }) @IsIn(PAID_FROM) paidFrom!: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

export class HireContractDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) ownerName!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PAN, { message: 'ownerPan is 5 letters, 4 digits, 1 letter' }) ownerPan?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9+ -]{6,20}$/, { message: 'ownerPhone looks wrong' }) ownerPhone?: string;
  @ApiProperty({ enum: ['per_trip', 'per_day', 'per_km', 'per_month'] }) @IsIn(['per_trip', 'per_day', 'per_km', 'per_month']) rateBasis!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) rate!: number;
  @ApiProperty() @IsBoolean() includesFuel!: boolean;
  @ApiProperty() @Matches(ISO_DATE, DATE) effectiveFrom!: string;
}

export class HireSuggestionQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
}

export class RecordHireBillDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) periodStart!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) periodEnd!: string;
  @ApiProperty({ description: 'Trips, days, km or months at the contract rate' }) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @ApiPropertyOptional({ description: "The owner's bill total, when it differs from quantity × rate" }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) billReference?: string;
}

export class PayHireBillDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) paidOn!: string;
  @ApiProperty({ enum: PAID_FROM }) @IsIn(PAID_FROM) paidFrom!: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional({ description: 'Withhold TDS under this section, e.g. 194C' }) @IsOptional() @IsString() @MaxLength(12) tdsSectionCode?: string;
}

export class FleetRangeQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vehicleId?: string;
}

export class HireBillsQueryDto {
  @ApiPropertyOptional({ enum: ['unpaid', 'paid'] }) @IsOptional() @IsIn(['unpaid', 'paid']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vehicleId?: string;
}
