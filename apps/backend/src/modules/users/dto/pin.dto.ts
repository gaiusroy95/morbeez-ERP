import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetPinDto {
  /** The phone's install id — the PIN works on this phone only. */
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({ example: '4826' })
  @Matches(/^\d{4,6}$/, { message: 'A PIN is 4 to 6 digits' })
  pin!: string;
}

export class RemovePinDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  deviceId!: string;
}

export class PinLoginDto extends SetPinDto {
  /** The driver's mobile number. */
  @ApiProperty({ example: '98220 11111' })
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  login!: string;
}
