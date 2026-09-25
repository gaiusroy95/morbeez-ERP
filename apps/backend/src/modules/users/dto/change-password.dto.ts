import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  // Changing a password requires proving you still know the current one
  // — otherwise a hijacked, still-logged-in session could lock the real
  // owner out permanently instead of just being revoked.
  @ApiProperty()
  @IsString()
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  newPassword!: string;
}
