import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PeriodQueryDto } from '../../../common/dto/period-query.dto';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_CODE = /^[a-z][a-z0-9_]{1,62}$/;

// Exactly one of debit and credit is positive on each line — checked by the
// service (and by money.ledger_line's own CHECK).
export class JournalLineDto {
  @ApiProperty()
  @Matches(ACCOUNT_CODE, { message: 'accountCode is not a valid account code' })
  accountCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;
}

export class CreateJournalDto {
  @ApiProperty({ description: 'Business date, tenant-local YYYY-MM-DD' })
  @Matches(ISO_DATE, { message: 'date must be a date in YYYY-MM-DD form' })
  date!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  memo!: string;

  @ApiPropertyOptional({ description: 'Voucher or bill number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty({ type: [JournalLineDto] })
  @ArrayMinSize(2)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class ReverseJournalDto {
  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'date must be a date in YYYY-MM-DD form' })
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  memo?: string;
}

export class ListJournalQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Only entries touching this account' })
  @IsOptional()
  @Matches(ACCOUNT_CODE)
  accountCode?: string;

  @ApiPropertyOptional({ description: 'Only manual journals and their reversals' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  manualOnly?: boolean;
}

export class AsOfQueryDto {
  @ApiPropertyOptional({ description: 'Tenant-local YYYY-MM-DD; defaults to today' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'asOf must be a date in YYYY-MM-DD form' })
  asOf?: string;
}

export class ClosePreviewQueryDto {
  @ApiProperty()
  @Matches(ISO_DATE, { message: 'through must be a date in YYYY-MM-DD form' })
  through!: string;
}

export class ClosePeriodDto {
  @ApiProperty({ description: 'Close the books through this date (tenant-local)' })
  @Matches(ISO_DATE, { message: 'through must be a date in YYYY-MM-DD form' })
  through!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReopenPeriodDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
