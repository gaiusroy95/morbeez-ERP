import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { FarmerContactDto } from './farmer-contact.dto';
import { BankDetailsDto } from './bank-details.dto';

export class CreateFarmerDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ type: FarmerContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FarmerContactDto)
  contact?: FarmerContactDto;

  @ApiPropertyOptional({ type: BankDetailsDto, description: 'May be added later — not required at onboarding' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;
}
