import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MinLength } from 'class-validator';

/** Choosing a password from a one-time set-up link. */
export class CompletePasswordSetupDto {
  @ApiProperty()
  @IsString()
  @Length(20, 100)
  token!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  password!: string;
}
