import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { VersionDto } from './version.dto';

/**
 * The driver submits the trip for the owner's reconciliation ("completed,
 * awaiting owner reconciliation"), saying how much cash they're handing
 * over. Both fields are optional so a dispatcher can still complete a trip
 * the way they always have.
 */
export class SubmitTripDto extends VersionDto {
  @ApiPropertyOptional({ minimum: 0, description: 'Cash the driver says they are handing over' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cashDeclared?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
