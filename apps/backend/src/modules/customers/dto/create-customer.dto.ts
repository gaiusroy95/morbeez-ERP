import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
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
import { LANGUAGES } from '../../../common/languages';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ type: CustomerContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerContactDto)
  contact?: CustomerContactDto;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 180, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ enum: LANGUAGES, description: "The customer's language for statements, reminders and WhatsApp; tax invoices stay English" })
  @IsOptional()
  @IsIn(LANGUAGES)
  preferredLanguage?: string;
}
