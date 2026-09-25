import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductRecord } from './entities/product.entity';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('products:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductRecord>> {
    return this.productsService.list(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get(':id')
  @RequirePermissions('products:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<ProductRecord> {
    return this.productsService.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('products:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateProductDto): Promise<ProductRecord> {
    return this.productsService.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('products:write')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductRecord> {
    return this.productsService.update(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('products:write')
  archive(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<ProductRecord> {
    return this.productsService.archive(user.tenantId, user.userId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('products:write')
  restore(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<ProductRecord> {
    return this.productsService.restore(user.tenantId, user.userId, id);
  }
}
