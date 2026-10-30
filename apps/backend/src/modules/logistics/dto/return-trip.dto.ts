import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Return (driver app D4): the odometer when the vehicle is back. */
export class ReturnTripDto {
  @ApiProperty({ description: 'Closing KM: never below the opening KM' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(9_999_999)
  closingKm!: number;
}

/** A customer disputing part of what they owe (driver app D4): it goes to the owner — the driver can't write anything off. */
export class RaiseStopDisputeDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
