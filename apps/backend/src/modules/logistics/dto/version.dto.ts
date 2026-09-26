import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

// A bare version envelope — reused by start/complete/cancel trip actions
// (each bounded context owns its own copy, Constitution I.3-I.4).
export class VersionDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;
}
