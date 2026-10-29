import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { VALID_ROLE_TYPES } from '../entities/employee.entity';

const PHONE = /^[0-9+ -]{6,20}$/;

/** Adding a worker with their contact details in one step. */
export class AddWorkerDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ enum: VALID_ROLE_TYPES }) @IsIn(VALID_ROLE_TYPES as unknown as string[]) roleType!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE, { message: 'phone looks wrong' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string | null;
}

export class UploadWorkerDocumentDto {
  @ApiProperty({ enum: ['aadhaar', 'driving_licence', 'pan', 'photo', 'other'] })
  @IsIn(['aadhaar', 'driving_licence', 'pan', 'photo', 'other'])
  kind!: 'aadhaar' | 'driving_licence' | 'pan' | 'photo' | 'other';

  @ApiPropertyOptional({ description: 'e.g. the licence number, or what an "other" document is' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class LoginLinkDto {
  @ApiPropertyOptional({ description: 'The mobile number to sign in with, when the worker has no login yet; defaults to the one on their profile' })
  @IsOptional()
  @Matches(PHONE, { message: 'phone looks wrong' })
  phone?: string;
}
