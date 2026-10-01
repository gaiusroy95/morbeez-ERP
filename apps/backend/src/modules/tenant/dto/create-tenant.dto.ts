import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeIndianMobile } from '../../../common/phone';

// Provisions a brand-new business account and its first user (Owner) in
// one atomic step — the one place in the whole API that creates a user
// without an existing auth context, because by definition there isn't
// one yet (Domain Model: Tenant is the root; nothing conforms to it).
// The owner signs in with their mobile number; an email is optional.
export class CreateTenantDto {
  @ApiProperty({ description: 'The business name' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName!: string;

  // Normalized here, so however it's typed it's stored as +91XXXXXXXXXX.
  @ApiProperty({ example: '98220 11111' })
  @Transform(({ value }) => (typeof value === 'string' ? (normalizeIndianMobile(value) ?? value) : value))
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, { message: 'Enter a 10-digit Indian mobile number' })
  ownerPhone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  ownerPassword!: string;
}
