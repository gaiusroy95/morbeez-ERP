import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { VALID_VEHICLE_STATUSES } from '../entities/vehicle.entity';

export class SetVehicleStatusDto {
  @ApiProperty({ enum: VALID_VEHICLE_STATUSES })
  @IsIn(VALID_VEHICLE_STATUSES)
  status!: string;
}
