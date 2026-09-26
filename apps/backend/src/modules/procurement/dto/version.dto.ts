import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

// A bare version envelope — reused by every action that changes nothing
// but a status and needs optimistic-concurrency protection (cancel,
// complete-pickup) without any other field.
export class VersionDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;
}
