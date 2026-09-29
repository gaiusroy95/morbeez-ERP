import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE = { message: 'must be a date in YYYY-MM-DD form' };

export class SpotSettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty({ description: 'Percent below the base price a driver may go without approval' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) defaultFloorPct!: number;
  @ApiProperty({ description: 'Percent above the base price' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(500) defaultCeilingPct!: number;
}

export class PriceBandDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) minPrice!: number;
  @ApiPropertyOptional({ description: 'No ceiling when left out' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) maxPrice?: number;
  @ApiProperty() @Matches(ISO_DATE, DATE) effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class SpotSaleLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000) quantity!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) unitPrice!: number;
}

export class RecordSpotSaleDto {
  @ApiProperty({ description: 'Generated on the device; a replay with the same one returns the same sale (DRV.5/6)' }) @IsUUID() clientRef!: string;
  @ApiProperty() @IsUUID() tripId!: string;
  @ApiProperty({ type: [SpotSaleLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SpotSaleLineDto) lines!: SpotSaleLineDto[];
  @ApiProperty({ enum: ['cash', 'upi'] }) @IsIn(['cash', 'upi']) paymentMethod!: 'cash' | 'upi';
  @ApiPropertyOptional({ description: 'UPI transaction id' }) @IsOptional() @IsString() @MaxLength(60) paymentReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) buyerName?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9+ -]{6,20}$/, { message: 'buyerPhone looks wrong' }) buyerPhone?: string;
  @ApiPropertyOptional({ description: 'When it happened on the device (offline); defaults to now' }) @IsOptional() @IsISO8601() soldAt?: string;
}

export class SpotDecisionDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class SpotListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, DATE) to?: string;
  @ApiPropertyOptional({ enum: ['pending_approval', 'completed', 'rejected', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending_approval', 'completed', 'rejected', 'cancelled'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tripId?: string;
}

export class SpotSummaryQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
}
