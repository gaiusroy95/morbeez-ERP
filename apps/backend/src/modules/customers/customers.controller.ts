import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateCreditTermsDto } from './dto/update-credit-terms.dto';
import { CustomerRecord } from './entities/customer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CustomersBoardQueryDto } from './dto/customers-board.dto';
import { CustomerProfile, CustomersBoard } from './entities/customer-insights.entity';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('customers:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<CustomerRecord>> {
    return this.customersService.list(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  /** The Customers list (redesign V1.1): filters, route, search; money for finance:read. */
  @Get('board')
  @RequirePermissions('customers:read')
  board(@CurrentUser() user: AuthContext, @Query() query: CustomersBoardQueryDto): Promise<CustomersBoard> {
    return this.customersService.board(
      user.tenantId,
      { filter: query.filter ?? 'all', routeId: query.routeId ?? null, q: query.q ?? null, page: query.page ?? 1, pageSize: query.pageSize ?? 100 },
      user.permissions.includes('finance:read'),
    );
  }

  /** Customer Profile: orders with orders:read, money with finance:read. */
  @Get(':id/profile')
  @RequirePermissions('customers:read')
  profile(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<CustomerProfile> {
    return this.customersService.profile(user.tenantId, id, {
      money: user.permissions.includes('finance:read'),
      orders: user.permissions.includes('orders:read'),
    });
  }

  @Get(':id')
  @RequirePermissions('customers:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('customers:write')
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateCustomerDto,
  ): Promise<CustomerRecord> {
    return this.customersService.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('customers:write')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerRecord> {
    return this.customersService.update(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/credit-terms')
  @RequirePermissions('customers:credit')
  updateCreditTerms(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreditTermsDto,
  ): Promise<CustomerRecord> {
    return this.customersService.updateCreditTerms(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('customers:write')
  archive(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.archive(user.tenantId, user.userId, id);
  }

  /** A new delivery QR for the shop (driver app D3). */
  @Post(':id/qr')
  @RequirePermissions('customers:write')
  newQr(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.newQr(user.tenantId, user.userId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('customers:write')
  restore(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.restore(user.tenantId, user.userId, id);
  }
}
