import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ReconcileTripDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ minimum: 0, description: 'Cash physically returned by the driver at the end of the trip' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cashReturned!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
