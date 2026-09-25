import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CustomerContactDto } from './customer-contact.dto';

// Deliberately no `status` field here — archiving/restoring is a distinct
// action with its own audit entry (POST .../archive, POST .../restore),
// not a side effect of a general-purpose field update.
export class UpdateCustomerDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency (Production Database, Section 03)' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ type: CustomerContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerContactDto)
  contact?: CustomerContactDto;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  paymentTermsDays?: number;
}
