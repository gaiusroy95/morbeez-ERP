import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/** Cash the driver paid into a bank account on the road. */
export class RecordDepositDto {
  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'Which account: bank and last digits, as the owner knows it' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankAccount!: string;

  @ApiProperty({ description: 'Deposit slip or transaction reference' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  reference!: string;

  @ApiPropertyOptional({ description: 'When it was deposited; defaults to now' })
  @IsOptional()
  @IsDateString()
  depositedAt?: string;
}
