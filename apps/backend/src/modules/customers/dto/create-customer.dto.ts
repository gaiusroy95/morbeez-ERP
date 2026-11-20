import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  MaxLength,
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

  @ApiPropertyOptional({ description: 'Village or town shown under the name', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  place?: string | null;

  @ApiPropertyOptional({ description: 'Default delivery address', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ description: 'The route this customer is usually delivered on', nullable: true })
  @IsOptional()
  @IsUUID()
  routeId?: string | null;

  @ApiPropertyOptional({ description: "Finance charge on what's overdue (MS §30) — off unless switched on; needs an annual rate", default: false })
  @IsOptional()
  @IsBoolean()
  financeChargeEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Percent a year on overdue amounts, charged per day (÷ 365)', minimum: 0, maximum: 60 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(60)
  financeChargeRateAnnual?: number;

  @ApiPropertyOptional({ description: 'Days past due before the charge starts', minimum: 0, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  financeChargeGraceDays?: number;

  @ApiPropertyOptional({ description: 'How a driver finds the shop ("opposite the bus stand")', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string | null;

  @ApiPropertyOptional({ description: "Where the shop is (GPS), with longitude — the customer's map pin", nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ description: 'With latitude', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
