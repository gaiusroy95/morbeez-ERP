import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { SetVehicleStatusDto } from './dto/set-vehicle-status.dto';
import { VehicleRecord, VehicleStatus } from './entities/vehicle.entity';

@ApiTags('vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  @RequirePermissions('vehicles:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<VehicleRecord>> {
    return this.vehiclesService.list(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get(':id')
  @RequirePermissions('vehicles:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<VehicleRecord> {
    return this.vehiclesService.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('vehicles:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateVehicleDto): Promise<VehicleRecord> {
    return this.vehiclesService.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('vehicles:write')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleRecord> {
    return this.vehiclesService.update(user.tenantId, user.userId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('vehicles:write')
  setStatus(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetVehicleStatusDto,
  ): Promise<VehicleRecord> {
    return this.vehiclesService.setStatus(user.tenantId, user.userId, id, dto.status as VehicleStatus);
  }
}
