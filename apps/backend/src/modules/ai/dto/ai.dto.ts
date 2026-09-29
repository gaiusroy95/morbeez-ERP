import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { RECOMMENDATION_TYPES, RecommendationType } from '../entities/ai.entity';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE = { message: 'must be a date in YYYY-MM-DD form' };

export class AiSettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(200) targetMarginPct!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100) maxPriceMovePct!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-100) @Max(100) minCustomerMarginPct!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(60) costOfCapitalPct!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) defaultCostPerKm!: number;
  @ApiProperty({ enum: RECOMMENDATION_TYPES, isArray: true }) @IsArray() @ArrayUnique() @IsIn(RECOMMENDATION_TYPES, { each: true }) disabledTypes!: RecommendationType[];
}

export class ListRecommendationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'decided', 'all'] }) @IsOptional() @IsIn(['open', 'decided', 'all']) status?: 'open' | 'decided' | 'all';
  @ApiPropertyOptional({ enum: RECOMMENDATION_TYPES }) @IsOptional() @IsIn(RECOMMENDATION_TYPES) type?: RecommendationType;
}

export class DecideRecommendationDto {
  @ApiProperty({ enum: ['acted', 'dismissed'], description: 'acted: the owner submitted the action (as suggested or changed); dismissed: not taken' })
  @IsIn(['acted', 'dismissed'])
  outcome!: 'acted' | 'dismissed';
  @ApiPropertyOptional({ description: 'What was actually submitted, for comparison with the proposal' }) @IsOptional() @IsObject() submitted?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Why — required to dismiss' }) @IsOptional() @IsString() @MinLength(2) @MaxLength(300) reason?: string;
  @ApiPropertyOptional({ description: 'What the action created, e.g. {"kind":"purchase_order","id":"…"}' }) @IsOptional() @IsObject() resultRef?: Record<string, unknown>;
}

export class ProfitQueryDto {
  @ApiProperty() @Matches(ISO_DATE, DATE) from!: string;
  @ApiProperty() @Matches(ISO_DATE, DATE) to!: string;
}
