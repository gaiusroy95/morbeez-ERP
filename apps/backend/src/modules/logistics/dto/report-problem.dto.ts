import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const PROBLEM_KINDS = ['driver_unable_to_continue', 'trip_blocked', 'operational_problem', 'security'] as const;

/** A driver tells the owner something that can't wait (client Q&A, E: Q19). */
export class ReportProblemDto {
  @ApiProperty({ enum: PROBLEM_KINDS })
  @IsIn(PROBLEM_KINDS)
  kind!: (typeof PROBLEM_KINDS)[number];

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}
