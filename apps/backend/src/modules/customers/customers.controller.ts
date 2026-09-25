import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { CustomerRecord } from './entities/customer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';

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

  @Post(':id/archive')
  @RequirePermissions('customers:write')
  archive(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.archive(user.tenantId, user.userId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('customers:write')
  restore(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.restore(user.tenantId, user.userId, id);
  }
}
