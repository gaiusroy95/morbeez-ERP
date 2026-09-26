import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

// Completing a pickup fixes the vehicle and driver actually used — if
// they weren't set at scheduling time, they're required now (enforced by
// the database's pickup_completed_requires_vehicle_and_driver CHECK too).
export class CompletePickupDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty()
  @IsUUID()
  vehicleId!: string;

  @ApiProperty()
  @IsUUID()
  driverEmployeeId!: string;
}
