import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VersionDto } from './dto/version.dto';
import { OrderRecord, OrderStatus } from './entities/customer-order.entity';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('orders:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
    @Query('status') status?: OrderStatus,
  ): Promise<PaginatedResult<OrderRecord>> {
    return this.ordersService.listOrders(user.tenantId, status, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get(':id')
  @RequirePermissions('orders:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<OrderRecord> {
    return this.ordersService.getOrder(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('orders:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateOrderDto): Promise<OrderRecord> {
    return this.ordersService.createOrder(user.tenantId, user.userId, dto);
  }

  @Post(':id/confirm')
  @RequirePermissions('orders:write')
  confirm(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ): Promise<OrderRecord> {
    return this.ordersService.confirmOrder(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/finalize-confirmation')
  @RequirePermissions('orders:write')
  finalizeConfirmation(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<OrderRecord> {
    return this.ordersService.finalizeConfirmation(user.tenantId, user.userId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('orders:write')
  cancel(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ): Promise<OrderRecord> {
    return this.ordersService.cancelOrder(user.tenantId, user.userId, id, dto);
  }
}
