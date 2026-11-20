import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What a customer owed, or was owed to a farmer, when they came onto Morbeez. */
export class OpeningBalanceDto {
  @ApiProperty({ description: 'What is owed, in rupees', minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;

  @ApiPropertyOptional({ description: 'The day the balance stood at (YYYY-MM-DD) — today if left out; not in a closed period' })
  @IsOptional()
  @Matches(DAY, { message: 'asOf must be a date, YYYY-MM-DD' })
  asOf?: string;

  @ApiPropertyOptional({ description: 'When it is due (YYYY-MM-DD) — the as-of day if left out' })
  @IsOptional()
  @Matches(DAY, { message: 'dueDate must be a date, YYYY-MM-DD' })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Where it came from, e.g. "Old ledger, page 14"' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
