import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  /** A mobile number (any common Indian format) or an email address. */
  @ApiPropertyOptional({ example: '98220 11111' })
  @ValidateIf((dto: LoginDto) => dto.email === undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  login?: string;

  /** Older clients send the login as `email`; accepted until they update. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1024)
  password!: string;

  /** The driver app's install id, so a lost phone's session can be revoked on its own (DRV.11). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}
