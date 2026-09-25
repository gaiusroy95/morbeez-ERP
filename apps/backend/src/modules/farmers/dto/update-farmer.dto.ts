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
}
