import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

export class TransferLotDto {
  @ApiProperty({ description: "The lot's version last read by the caller — optimistic concurrency" })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty()
  @IsUUID()
  toLocationId!: string;
}
