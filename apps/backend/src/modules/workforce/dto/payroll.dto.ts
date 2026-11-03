import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string | null;
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

const INCENTIVE_KINDS = ['collection', 'backhaul', 'mileage', 'crates', 'quality', 'new_customer', 'performance', 'night_duty', 'data_quality', 'completion'];
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export class DriverIncentiveRuleDto {
  @ApiProperty({ enum: INCENTIVE_KINDS }) @IsIn(INCENTIVE_KINDS) kind!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ description: 'Percent of its base, up to 3 decimals' }) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) percent!: number;
}

export class DataQualityNeedsDto {
  @ApiProperty() @IsBoolean() km!: boolean;
  @ApiProperty() @IsBoolean() deliveryPhotos!: boolean;
  @ApiProperty() @IsBoolean() bills!: boolean;
}

/** When each incentive is earned — the owner's to change. */
export class IncentiveConditionsDto {
  @ApiProperty({ description: 'Collection: at least this much collected on the trip' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) minCollected!: number;
  @ApiProperty({ description: 'Crates: at least this many brought back' }) @IsInt() @Min(1) @Max(10_000) minCrates!: number;
  @ApiProperty({ description: 'Quality: deliveries that may be short' }) @IsInt() @Min(0) @Max(100) qualityShortAllowed!: number;
  @ApiProperty({ description: 'Performance: stops that may be left undone' }) @IsInt() @Min(0) @Max(100) performanceSkipsAllowed!: number;
  @ApiProperty({ type: DataQualityNeedsDto }) @ValidateNested() @Type(() => DataQualityNeedsDto) dataQualityNeeds!: DataQualityNeedsDto;
  @ApiProperty({ description: 'Trip completion: also when closed as an approved exception' }) @IsBoolean() completionOnException!: boolean;
}

/** The owner's incentive rules for drivers (driver app D7): all ten at once. */
export class DriverIncentivesDto {
  @ApiProperty({ description: '0 when saving for the first time' }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ type: [DriverIncentiveRuleDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DriverIncentiveRuleDto)
  rules!: DriverIncentiveRuleDto[];
  @ApiPropertyOptional({ description: 'The mileage incentive: km per litre the vehicle should do' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(100)
  targetKmPerLitre?: number | null;
  @ApiProperty({ example: '21:00' }) @Matches(CLOCK, { message: 'nightFrom must be HH:MM' }) nightFrom!: string;
  @ApiProperty({ example: '05:00' }) @Matches(CLOCK, { message: 'nightUntil must be HH:MM' }) nightUntil!: string;
  @ApiPropertyOptional({ type: IncentiveConditionsDto, description: 'Left out: kept as they are' })
  @IsOptional()
  @ValidateNested()
  @Type(() => IncentiveConditionsDto)
  conditions?: IncentiveConditionsDto;
}
