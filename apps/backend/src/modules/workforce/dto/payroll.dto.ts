import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
const STATE = /^[0-9]{2}$/;

export class PayrollSettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiPropertyOptional({ description: 'GST-style 2-digit state code used when a worker has none' })
  @IsOptional()
  @Matches(STATE, { message: 'defaultStateCode must be a 2-digit state code' })
  defaultStateCode?: string | null;
  @ApiProperty({ enum: ['top_up', 'warn'] }) @IsIn(['top_up', 'warn']) minWagePolicy!: 'top_up' | 'warn';
}

export class WorkerProfileDto {
  @ApiProperty({ description: '0 when saving for the first time' }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['permanent', 'casual', 'contract'] }) @IsIn(['permanent', 'casual', 'contract']) employmentType!: string;
  @ApiProperty({ enum: ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] })
  @IsIn(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'])
  skillCategory!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(STATE, { message: 'workStateCode must be a 2-digit state code' }) workStateCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) joinedOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) leftOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9+ -]{6,20}$/, { message: 'phone looks wrong' }) phone?: string | null;
}

export class PayRateDto {
  @ApiProperty({ enum: ['monthly', 'daily', 'hourly', 'piece'] }) @IsIn(['monthly', 'daily', 'hourly', 'piece']) payBasis!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) rate!: number;
  @ApiPropertyOptional({ description: 'What one piece is — crate, bag, kg' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unitLabel?: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) effectiveFrom!: string;
}

export class CreateAssignmentDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) workDate!: string;
  @ApiProperty({ enum: ['warehouse', 'loading', 'grading', 'market', 'other'], description: 'Trips are recorded by Logistics' })
  @IsIn(['warehouse', 'loading', 'grading', 'market', 'other'])
  kind!: string;
  @ApiProperty({ enum: ['planned', 'completed', 'absent'] }) @IsIn(['planned', 'completed', 'absent']) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(24) hours?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) units?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class UpdateAssignmentDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ enum: ['planned', 'completed', 'absent', 'cancelled'] }) @IsIn(['planned', 'completed', 'absent', 'cancelled']) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(24) hours?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) units?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string | null;
}

export class ListAssignmentsQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}

export class IncentiveRuleDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @ApiPropertyOptional({ enum: ['driver', 'warehouse', 'procurement', 'finance', 'other'] })
  @IsOptional()
  @IsIn(['driver', 'warehouse', 'procurement', 'finance', 'other'])
  roleType?: string | null;
  @ApiProperty({ enum: ['per_trip', 'per_unit', 'attendance'] }) @IsIn(['per_trip', 'per_unit', 'attendance']) basis!: string;
  @ApiProperty({ description: 'Trips/units above this earn it; days worked at least this for attendance' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  threshold!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) effectiveFrom!: string;
}

export class MinimumWageDto {
  @ApiProperty() @Matches(STATE, { message: 'stateCode must be a 2-digit state code' }) stateCode!: string;
  @ApiProperty({ enum: ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] })
  @IsIn(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'])
  skillCategory!: string;
  @ApiProperty({ description: 'Basic + variable dearness allowance, per day' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) dailyRate!: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) effectiveFrom!: string;
  @ApiPropertyOptional({ description: 'The notification it comes from' }) @IsOptional() @IsString() @MaxLength(300) source?: string;
}

export class EndRuleDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) effectiveTo!: string;
}

export class RecordAdvanceDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) paidOn!: string;
  @ApiProperty({ enum: ['bank', 'cash_on_hand'] }) @IsIn(['bank', 'cash_on_hand']) paidFrom!: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class AdjustmentDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) description!: string;
  @ApiProperty({ description: 'Positive adds to pay; negative is a deduction' }) @IsNumber({ maxDecimalPlaces: 2 }) amount!: number;
}

export class EarningsQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
}

export class DraftSettlementsDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) employeeIds!: string[];
  @ApiPropertyOptional({ type: [AdjustmentDto], description: 'Only with a single worker' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentDto)
  adjustments?: AdjustmentDto[];
  @ApiPropertyOptional({ description: 'Most to recover from advances per worker; omit for as much as pay allows' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxAdvanceRecovery?: number;
}

export class ListSettlementsQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'approved', 'paid', 'void'] }) @IsOptional() @IsIn(['draft', 'approved', 'paid', 'void']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) to?: string;
}

export class VersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class PaySettlementDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ enum: ['bank', 'cash_on_hand'] }) @IsIn(['bank', 'cash_on_hand']) paidFrom!: 'bank' | 'cash_on_hand';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class VoidSettlementDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
