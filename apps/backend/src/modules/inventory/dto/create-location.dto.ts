import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { LocationType } from '../entities/location.entity';

const VALID_TYPES: LocationType[] = ['warehouse', 'vehicle', 'other'];

// vehicleId is required exactly when type is 'vehicle' — checked in
// InventoryService, not here (a cross-field rule, same as
// commerce.lot's own grading constraints being enforced in the service
// before the database's own CHECK backstops it).
export class CreateLocationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ enum: VALID_TYPES, default: 'warehouse' })
  @IsOptional()
  @IsIn(VALID_TYPES)
  type?: LocationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
