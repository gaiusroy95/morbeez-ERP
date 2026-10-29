import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { RoutesService } from './routes.service';
import { RouteRecord, RouteStopRecord } from './entities/route.entity';
import { CreateRouteDto, SetRouteStopsDto, UpdateRouteDto } from './dto/create-route.dto';

// Reading routes needs only a login: orders, customers and trips are all
// planned by route, by people holding different permissions (the ops
// manager plans trips without orders access). Changing them is under the
// orders permissions — whoever takes orders adds a route from the order form.
@ApiTags('routes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  list(@CurrentUser() user: AuthContext): Promise<RouteRecord[]> {
    return this.routes.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('orders:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateRouteDto): Promise<RouteRecord> {
    return this.routes.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('orders:write')
  update(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRouteDto): Promise<RouteRecord> {
    return this.routes.update(user.tenantId, user.userId, id, dto);
  }

  /** The route's customers and farmers, in the order the vehicle visits them. */
  @Get(':id/stops')
  stops(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<RouteStopRecord[]> {
    return this.routes.stops(user.tenantId, id);
  }

  @Put(':id/stops')
  @RequirePermissions('orders:write')
  setStops(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRouteStopsDto): Promise<RouteStopRecord[]> {
    return this.routes.setStops(user.tenantId, user.userId, id, dto);
  }
}
