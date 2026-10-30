import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** A message: the sender's own id, so sending it again (offline, then back) is the same message. */
export class SendMessageDto {
  @ApiProperty() @IsUUID() id!: string;

  @ApiPropertyOptional({ description: 'The words; a photo message may have none' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional({ description: 'The trip it is about — one of the driver’s' })
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @ApiPropertyOptional({ description: 'A photo follows it' })
  @IsOptional()
  @IsBoolean()
  photo?: boolean;

  @ApiPropertyOptional({ description: 'When it was written, if earlier than now (sent later from a phone that was offline)' })
  @IsOptional()
  @IsDateString()
  writtenAt?: string;
}

export class ReadUpToDto {
  @ApiPropertyOptional({ description: 'Read up to this message’s arrival (its createdAt); now when left out' })
  @IsOptional()
  @IsDateString()
  upTo?: string;
}
