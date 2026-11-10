import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  MaxLength,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FarmerContactDto } from './farmer-contact.dto';
import { BankDetailsDto } from './bank-details.dto';

export class UpdateFarmerDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ description: 'Village or town' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  place?: string | null;

  @ApiPropertyOptional({ type: FarmerContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FarmerContactDto)
  contact?: FarmerContactDto;

  @ApiPropertyOptional({ type: BankDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;

  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  reliabilityRating?: number;

  @ApiPropertyOptional({ enum: ['immediate', 'bill_to_bill', 'net', 'custom'], description: 'When a graded lot falls due (MS §12)' })
  @IsOptional()
  @IsIn(['immediate', 'bill_to_bill', 'net', 'custom'])
  paymentTerms?: 'immediate' | 'bill_to_bill' | 'net' | 'custom';

  @ApiPropertyOptional({ description: 'Net: 3, 7, 10, 15, 20, 30, 45 or 60; Custom and Bill-to-Bill (the longest a payable may wait): 1–180. Not for Immediate.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  paymentTermsDays?: number;
}
