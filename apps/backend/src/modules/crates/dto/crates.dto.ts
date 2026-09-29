import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE = { message: 'must be a date in YYYY-MM-DD form' };
const PAID_FROM = ['bank', 'cash_on_hand'] as const;
export const RECORDABLE_KINDS = ['purchased', 'opening', 'issued', 'returned', 'loaded', 'unloaded', 'delivered', 'collected'] as const;

export class CrateSettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty({ description: 'A customer holding crates longer than this is overdue' }) @IsInt() @Min(1) @Max(365) customerOverdueDays!: number;
  @ApiProperty({ description: 'A farmer holding crates longer than this is overdue' }) @IsInt() @Min(1) @Max(365) farmerOverdueDays!: number;
}

export class CreateCrateTypeDto {
  @ApiProperty({ description: 'Short code, e.g. PL20' }) @Matches(/^[A-Za-z0-9-]{1,12}$/, { message: 'code is 1–12 letters, digits or dashes' }) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) capacityKg?: number;
  @ApiProperty({ description: 'What a lost crate is charged at' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) replacementCost!: number;
  @ApiPropertyOptional({ description: 'HSN for charging lost crates, e.g. 3923' }) @IsOptional() @Matches(/^[0-9]{4}([0-9]{2}){0,2}$/, { message: 'hsnCode is 4, 6 or 8 digits' }) hsnCode?: string;
  @ApiPropertyOptional({ description: 'Warn when the yard holds fewer' }) @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
}

export class UpdateCrateTypeDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) capacityKg?: number | null;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) replacementCost!: number;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9]{4}([0-9]{2}){0,2}$/, { message: 'hsnCode is 4, 6 or 8 digits' }) hsnCode?: string | null;
  @ApiProperty() @IsInt() @Min(0) reorderLevel!: number;
  @ApiProperty() @IsBoolean() isActive!: boolean;
}

export class CrateLimitDto {
  @ApiProperty({ enum: ['customer', 'farmer'] }) @IsIn(['customer', 'farmer']) holderKind!: 'customer' | 'farmer';
  @ApiProperty() @IsUUID() holderId!: string;
  @ApiPropertyOptional({ description: 'null removes the limit' }) @IsOptional() @IsInt() @Min(0) @Max(100000) maxCrates?: number | null;
}

export class CrateLineDto {
  @ApiProperty() @IsUUID() crateTypeId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) quantity!: number;
}

export class RecordMovementDto {
  @ApiProperty({ enum: RECORDABLE_KINDS }) @IsIn(RECORDABLE_KINDS) kind!: (typeof RECORDABLE_KINDS)[number];
  @ApiPropertyOptional({ enum: ['customer', 'farmer'], description: 'The customer or farmer, for issued, returned, delivered, collected and opening' })
  @IsOptional()
  @IsIn(['customer', 'farmer'])
  partyKind?: 'customer' | 'farmer';
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional({ description: 'The vehicle, for loaded, unloaded, delivered, collected and opening' }) @IsOptional() @IsUUID() vehicleId?: string;
  @ApiProperty({ type: [CrateLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CrateLineDto) lines!: CrateLineDto[];
  @ApiPropertyOptional({ description: 'Defaults to today' }) @IsOptional() @Matches(ISO_DATE, DATE) occurredOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tripId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional({ description: 'Purchased only: what the crates cost in all' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) cost?: number;
  @ApiPropertyOptional({ enum: PAID_FROM }) @IsOptional() @IsIn(PAID_FROM) paidFrom?: 'bank' | 'cash_on_hand';
}

export class StopCountLineDto {
  @ApiProperty() @IsUUID() crateTypeId!: string;
  @ApiProperty({ description: 'Crates left with the customer or farmer' }) @IsInt() @Min(0) @Max(100000) dropped!: number;
  @ApiProperty({ description: 'Crates taken back from them' }) @IsInt() @Min(0) @Max(100000) collected!: number;
}

export class StopCountsDto {
  @ApiProperty({ type: [StopCountLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => StopCountLineDto) lines!: StopCountLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class ReverseMovementDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class RecordLossDto {
  @ApiProperty({ enum: ['yard', 'customer', 'farmer', 'vehicle'] }) @IsIn(['yard', 'customer', 'farmer', 'vehicle']) holderKind!: 'yard' | 'customer' | 'farmer' | 'vehicle';
  @ApiPropertyOptional({ description: 'Not for the yard' }) @IsOptional() @IsUUID() holderId?: string;
  @ApiProperty() @IsUUID() crateTypeId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) quantity!: number;
  @ApiProperty({ enum: ['absorbed', 'charge'], description: 'charge: invoice a customer, or deduct from a farmer' }) @IsIn(['absorbed', 'charge']) recovery!: 'absorbed' | 'charge';
  @ApiPropertyOptional({ description: 'Per crate; defaults to its replacement cost' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) unitCharge?: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) occurredOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tripId?: string;
}

export class HoldingsQueryDto {
  @ApiPropertyOptional({ enum: ['yard', 'customer', 'farmer', 'vehicle'] }) @IsOptional() @IsIn(['yard', 'customer', 'farmer', 'vehicle']) kind?: 'yard' | 'customer' | 'farmer' | 'vehicle';
}

export class MovementsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) to?: string;
  @ApiPropertyOptional({ enum: ['yard', 'customer', 'farmer', 'vehicle'] }) @IsOptional() @IsIn(['yard', 'customer', 'farmer', 'vehicle']) holderKind?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() holderId?: string;
}
