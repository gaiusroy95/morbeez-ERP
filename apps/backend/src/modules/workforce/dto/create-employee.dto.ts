import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { VALID_ROLE_TYPES } from '../entities/employee.entity';
import { EmploymentTermsDto } from './employment-terms.dto';

export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ enum: VALID_ROLE_TYPES })
  @IsIn(VALID_ROLE_TYPES)
  roleType!: string;

  @ApiPropertyOptional({ description: "Links to an existing login (identity.app_user) — not every employee has one" })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ type: EmploymentTermsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmploymentTermsDto)
  employmentTerms?: EmploymentTermsDto;
}
