import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReversePaymentDto {
  @ApiProperty({ example: 'Cheque 004512 returned unpaid' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
