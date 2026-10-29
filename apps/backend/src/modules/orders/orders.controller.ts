import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { OrdersService, PriceSuggestion } from './orders.service';
import { PriceSuggestionsQueryDto } from './dto/price-suggestions-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { VersionDto } from './dto/version.dto';
import { OrderRecord } from './entities/customer-order.entity';
import { OrdersBoardQueryDto } from './dto/orders-board.dto';
import { OrdersBoard } from './entities/orders-board.entity';

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
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderRecord>> {
    return this.ordersService.listOrders(user.tenantId, query.status, query.page ?? 1, query.pageSize ?? 25);
  }

  /** The Delivery Orders list: Today / Tomorrow / All, with search (redesign V1.1). */
  @Get('board')
  @RequirePermissions('orders:read')
  board(@CurrentUser() user: AuthContext, @Query() query: OrdersBoardQueryDto): Promise<OrdersBoard> {
    return this.ordersService.getBoard(user.tenantId, query.day ?? 'today', query.q ?? null, query.page ?? 1, query.pageSize ?? 50);
  }

  /** The suggested starting price for each product on a new order for this customer. */
  @Get('price-suggestions')
  @RequirePermissions('orders:read')
  priceSuggestions(@CurrentUser() user: AuthContext, @Query() query: PriceSuggestionsQueryDto): Promise<PriceSuggestion[]> {
    return this.ordersService.priceSuggestions(user.tenantId, query.customerId, query.productIds);
  }

  @Get(':id')
  @RequirePermissions('orders:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<OrderRecord> {
    return this.ordersService.getOrder(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('orders:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateOrderDto): Promise<OrderRecord & { confirmProblem?: string }> {
    return this.ordersService.createOrder(user.tenantId, user.userId, dto, {
      mayExtendCredit: user.permissions.includes('customers:credit'),
    });
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
