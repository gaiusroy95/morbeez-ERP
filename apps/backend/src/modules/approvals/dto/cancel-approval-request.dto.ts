import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CancelApprovalRequestDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;
}
