import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { VersionDto } from './version.dto';

/** Holding a trip or returning it to the driver always says why. */
export class TripDecisionDto extends VersionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}
