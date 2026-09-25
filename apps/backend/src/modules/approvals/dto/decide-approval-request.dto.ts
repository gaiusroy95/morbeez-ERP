import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class DecideApprovalRequestDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
