import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  // Length over forced complexity — current OWASP guidance, and simpler
  // for a legitimate user to satisfy than an arbitrary
  // uppercase/digit/symbol rule that mostly just encourages "Password1!".
  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  password!: string;
}
