import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsDateString, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateTripDto {
  @ApiProperty()
  @IsUUID()
  vehicleId!: string;

  @ApiProperty()
  @IsUUID()
  driverEmployeeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Cash float handed to the driver before departure' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  advanceAmount?: number;

  // Planning by route (redesign Phase 4, "Create Trip"): the route, the
  // crew, and the orders and pickups it carries — its stops are made in
  // the route's visiting order.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  packerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  loaderEmployeeId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Confirmed orders to deliver on it' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Scheduled pickups to collect on it' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  pickupIds?: string[];
}
