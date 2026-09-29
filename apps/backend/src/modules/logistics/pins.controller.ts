import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PinKind, PinsService, PlacePin } from './pins.service';

export class SetPinDto {
  @ApiProperty({ enum: ['customer', 'farmer', 'depot'] }) @IsIn(['customer', 'farmer', 'depot']) kind!: PinKind;
  @ApiPropertyOptional({ description: 'The customer or farmer; not for the depot' }) @IsOptional() @IsUUID() refId?: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 6 }) @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 6 }) @Min(-180) @Max(180) longitude!: number;
}

// Map pins for route planning — planning routes is dispatch's job.
@ApiTags('logistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('logistics/pins')
export class PinsController {
  constructor(private readonly pins: PinsService) {}

  @Get()
  @RequirePermissions('logistics:dispatch')
  list(@CurrentUser() user: AuthContext): Promise<PlacePin[]> {
    return this.pins.list(user.tenantId);
  }

  @Put()
  @RequirePermissions('logistics:dispatch')
  set(@CurrentUser() user: AuthContext, @Body() dto: SetPinDto): Promise<PlacePin[]> {
    return this.pins.set(user.tenantId, user.userId, dto.kind, dto.refId ?? null, dto.latitude, dto.longitude);
  }
}
