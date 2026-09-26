import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

// Post-acceptance rejection — a quality problem found in stock that had
// already cleared grading, distinct from Procurement's own grading-time
// rejection (GradeLotDto).
export class RecordRejectionDto {
  @ApiProperty({ description: "The lot's version last read by the caller — optimistic concurrency" })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
