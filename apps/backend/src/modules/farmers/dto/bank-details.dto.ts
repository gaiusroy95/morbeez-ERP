import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class BankDetailsDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  accountHolderName!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{6,20}$/, { message: 'accountNumber must be 6-20 digits' })
  accountNumber!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'ifscCode is not a valid IFSC code' })
  ifscCode!: string;
}
