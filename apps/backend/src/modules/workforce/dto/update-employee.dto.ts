import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { VALID_ROLE_TYPES } from '../entities/employee.entity';
import { EmploymentTermsDto } from './employment-terms.dto';

export class UpdateEmployeeDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ enum: VALID_ROLE_TYPES })
  @IsOptional()
  @IsIn(VALID_ROLE_TYPES)
  roleType?: string;

  @ApiPropertyOptional({ type: EmploymentTermsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmploymentTermsDto)
  employmentTerms?: EmploymentTermsDto;
}
