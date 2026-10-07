import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { CustomerContactDto } from './customer-contact.dto';
import { LANGUAGES } from '../../../common/languages';

// Deliberately no credit fields — limit, payment days, finance charges,
// and credit hold change only through POST .../credit-terms, under its own
// customers:credit permission (Constitution V.2).
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

  @ApiPropertyOptional({ enum: LANGUAGES, description: "The customer's language for statements, reminders and WhatsApp; tax invoices stay English" })
  @IsOptional()
  @IsIn(LANGUAGES)
  preferredLanguage?: string;
}
