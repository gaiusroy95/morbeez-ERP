import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, MaxLength, Min, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { FarmerContactDto } from './farmer-contact.dto';
import { BankDetailsDto } from './bank-details.dto';

export class CreateFarmerDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

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

  @ApiPropertyOptional({ type: BankDetailsDto, description: 'May be added later — not required at onboarding' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;

  @ApiPropertyOptional({ enum: ['immediate', 'bill_to_bill', 'net', 'custom'], description: 'When a graded lot falls due (MS §12); Immediate if left out' })
  @IsOptional()
  @IsIn(['immediate', 'bill_to_bill', 'net', 'custom'])
  paymentTerms?: 'immediate' | 'bill_to_bill' | 'net' | 'custom';

  @ApiPropertyOptional({ description: 'Net: 3, 7, 10, 15, 20, 30, 45 or 60; Custom and Bill-to-Bill: 1–180' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  paymentTermsDays?: number;
}
