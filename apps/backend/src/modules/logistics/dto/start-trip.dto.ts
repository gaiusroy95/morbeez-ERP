import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { VersionDto } from './version.dto';

/**
 * Starting a trip — the driver's Start Day (driver app V1, D1): the
 * vehicle's odometer, and where the phone was when the day started.
 */
export class StartTripDto extends VersionDto {
  @ApiPropertyOptional({ description: "The vehicle's odometer, km (opening KM)" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(9_999_999)
  openingKm?: number;

  @ApiPropertyOptional({ description: "The phone's position when the day started (GPS)" })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'How sure the position is, metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;
}
