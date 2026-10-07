import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class ReconcileTripDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ minimum: 0, description: 'Cash the owner received from the driver at handover' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cashReturned!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Required when anything checked is an exception (the cash doesn't match,
   * a delivery has no proof, a cash customer didn't pay...): closing then
   * means approving it with this reason on record.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  exceptionNote?: string;
}
