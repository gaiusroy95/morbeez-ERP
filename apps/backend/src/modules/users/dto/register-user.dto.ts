import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { normalizeIndianMobile } from '../../../common/phone';

/** A new staff login: a mobile number to sign in with, and optionally an email. */
export class RegisterUserDto {
  // Normalized here, so "98220 11111" and "+91 98220-11111" are the same login.
  @ApiProperty({ example: '98220 11111' })
  @Transform(({ value }) => (typeof value === 'string' ? (normalizeIndianMobile(value) ?? value) : value))
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, { message: 'phone must be a 10-digit Indian mobile number' })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  // Length over forced complexity — current OWASP guidance, and simpler
  // for a legitimate user to satisfy than an arbitrary
  // uppercase/digit/symbol rule that mostly just encourages "Password1!".
  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  password!: string;
}
