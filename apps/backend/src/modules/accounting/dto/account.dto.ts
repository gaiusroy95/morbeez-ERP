import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { GROUPS_BY_ROOT, ReportGroup, RootType } from '../entities/accounting.entity';

const ROOT_TYPES: RootType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const REPORT_GROUPS = Object.values(GROUPS_BY_ROOT).flat() as ReportGroup[];

// A tenant's own account. The code (its stable key) is derived from the
// name by the service; the number is what people see and sort by. That the
// group belongs under the root type is checked by the service and, again,
// by money.account's own CHECK.
export class CreateAccountDto {
  @ApiProperty({ minimum: 1, maximum: 99999 })
  @IsInt()
  @Min(1)
  @Max(99999)
  number!: number;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ROOT_TYPES })
  @IsIn(ROOT_TYPES)
  rootType!: RootType;

  @ApiProperty({ enum: REPORT_GROUPS })
  @IsIn(REPORT_GROUPS)
  reportGroup!: ReportGroup;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

// Root type and group never change once an account exists — its history
// would silently move between statements. Retire it and add a new one.
export class UpdateAccountDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99999)
  number?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListAccountsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
