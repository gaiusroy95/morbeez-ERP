import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class CreateRouteDto {
  @ApiProperty({ example: 'Mysuru North' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class UpdateRouteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class RouteStopDto {
  @ApiProperty({ enum: ['customer', 'farmer'] })
  @IsIn(['customer', 'farmer'])
  kind!: 'customer' | 'farmer';

  @ApiProperty()
  @IsUUID()
  partyId!: string;
}

/** The route's stops, every one, in visiting order. */
export class SetRouteStopsDto {
  @ApiProperty({ type: [RouteStopDto] })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => RouteStopDto)
  stops!: RouteStopDto[];
}
