import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

// Provisions a brand-new business account and its first user (Owner) in
// one atomic step — the one place in the whole API that creates a user
// without an existing auth context, because by definition there isn't
// one yet (Domain Model: Tenant is the root; nothing conforms to it).
export class CreateTenantDto {
  @ApiProperty({ description: 'The business name' })
  @IsString()
  @MinLength(2)
  businessName!: string;

  @ApiProperty()
  @IsEmail()
  ownerEmail!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  ownerPassword!: string;
}
