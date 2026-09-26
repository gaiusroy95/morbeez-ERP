import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { InventoryService } from './inventory.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RecordShrinkageDto } from './dto/record-shrinkage.dto';
import { RecordRejectionDto } from './dto/record-rejection.dto';
import { TransferLotDto } from './dto/transfer-lot.dto';
import { LocationRecord } from './entities/location.entity';
import { InventoryMovementRecord, StockSummary } from './entities/inventory-movement.entity';
import { LotRecord } from '../procurement/entities/lot.entity';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ---- Locations ----

  @Get('locations')
  @RequirePermissions('inventory:read')
  listLocations(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<LocationRecord>> {
    return this.inventoryService.listLocations(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get('locations/:id')
  @RequirePermissions('inventory:read')
  getLocation(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<LocationRecord> {
    return this.inventoryService.getLocation(user.tenantId, id);
  }

  @Post('locations')
  @RequirePermissions('inventory:write')
  createLocation(@CurrentUser() user: AuthContext, @Body() dto: CreateLocationDto): Promise<LocationRecord> {
    return this.inventoryService.createLocation(user.tenantId, user.userId, dto);
  }

  @Post('locations/:id')
  @RequirePermissions('inventory:write')
  updateLocation(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationRecord> {
    return this.inventoryService.updateLocation(user.tenantId, user.userId, id, dto);
  }

  @Post('locations/:id/archive')
  @RequirePermissions('inventory:write')
  archiveLocation(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<LocationRecord> {
    return this.inventoryService.archiveLocation(user.tenantId, user.userId, id);
  }

  @Post('locations/:id/restore')
  @RequirePermissions('inventory:write')
  restoreLocation(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<LocationRecord> {
    return this.inventoryService.restoreLocation(user.tenantId, user.userId, id);
  }

  // ---- Lot tracking ----

  @Get('products/:productId/stock-summary')
  @RequirePermissions('inventory:read')
  getStockSummary(@CurrentUser() user: AuthContext, @Param('productId') productId: string): Promise<StockSummary> {
    return this.inventoryService.getStockSummary(user.tenantId, productId);
  }

  @Get('products/:productId/lots')
  @RequirePermissions('inventory:read')
  listLotsForProduct(@CurrentUser() user: AuthContext, @Param('productId') productId: string): Promise<LotRecord[]> {
    return this.inventoryService.listLotsForProduct(user.tenantId, productId);
  }

  // ---- Shrinkage / rejection / transfers ----

  @Post('lots/:id/shrinkage')
  @RequirePermissions('inventory:write')
  recordShrinkage(
    @CurrentUser() user: AuthContext,
    @Param('id') lotId: string,
    @Body() dto: RecordShrinkageDto,
  ): Promise<LotRecord> {
    return this.inventoryService.recordShrinkage(user.tenantId, user.userId, lotId, dto);
  }

  @Post('lots/:id/reject')
  @RequirePermissions('inventory:write')
  recordRejection(
    @CurrentUser() user: AuthContext,
    @Param('id') lotId: string,
    @Body() dto: RecordRejectionDto,
  ): Promise<LotRecord> {
    return this.inventoryService.recordRejection(user.tenantId, user.userId, lotId, dto);
  }

  @Post('lots/:id/transfer')
  @RequirePermissions('inventory:write')
  transferLot(
    @CurrentUser() user: AuthContext,
    @Param('id') lotId: string,
    @Body() dto: TransferLotDto,
  ): Promise<LotRecord> {
    return this.inventoryService.transferLot(user.tenantId, user.userId, lotId, dto);
  }

  // ---- Movement history ----

  @Get('lots/:id/movements')
  @RequirePermissions('inventory:read')
  listMovementsForLot(
    @CurrentUser() user: AuthContext,
    @Param('id') lotId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<InventoryMovementRecord>> {
    return this.inventoryService.listMovementsForLot(user.tenantId, lotId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get('products/:productId/movements')
  @RequirePermissions('inventory:read')
  listMovementsForProduct(
    @CurrentUser() user: AuthContext,
    @Param('productId') productId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<InventoryMovementRecord>> {
    return this.inventoryService.listMovementsForProduct(
      user.tenantId,
      productId,
      query.page ?? 1,
      query.pageSize ?? 25,
    );
  }
}
