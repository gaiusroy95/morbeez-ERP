import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { ProcurementService } from './procurement.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { VersionDto } from './dto/version.dto';
import { SchedulePickupDto } from './dto/schedule-pickup.dto';
import { CompletePickupDto } from './dto/complete-pickup.dto';
import { ReceiveGoodsDto } from './dto/receive-goods.dto';
import { GradeLotDto } from './dto/grade-lot.dto';
import { SettleFarmerDto } from './dto/settle-farmer.dto';
import { PurchaseOrderRecord, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PickupRecord } from './entities/pickup.entity';
import { LotRecord } from './entities/lot.entity';
import { FarmerSettlementRecord } from './entities/farmer-settlement.entity';

@ApiTags('procurement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('procurement')
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  // ---- Purchase orders ----

  @Get('purchase-orders')
  @RequirePermissions('procurement:read')
  listPurchaseOrders(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
    @Query('status') status?: PurchaseOrderStatus,
  ): Promise<PaginatedResult<PurchaseOrderRecord>> {
    return this.procurementService.listPurchaseOrders(
      user.tenantId,
      status,
      query.page ?? 1,
      query.pageSize ?? 25,
    );
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('procurement:read')
  getPurchaseOrder(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderRecord> {
    return this.procurementService.getPurchaseOrder(user.tenantId, id);
  }

  @Post('purchase-orders')
  @RequirePermissions('procurement:write')
  createPurchaseOrder(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderRecord> {
    return this.procurementService.createPurchaseOrder(user.tenantId, user.userId, dto);
  }

  @Post('purchase-orders/:id/confirm')
  @RequirePermissions('procurement:write')
  confirmPurchaseOrder(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
  ): Promise<PurchaseOrderRecord> {
    return this.procurementService.confirmPurchaseOrder(user.tenantId, user.userId, id, dto);
  }

  @Post('purchase-orders/:id/finalize-confirmation')
  @RequirePermissions('procurement:write')
  finalizeConfirmation(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderRecord> {
    return this.procurementService.finalizeConfirmation(user.tenantId, user.userId, id);
  }

  @Post('purchase-orders/:id/cancel')
  @RequirePermissions('procurement:write')
  cancelPurchaseOrder(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ): Promise<PurchaseOrderRecord> {
    return this.procurementService.cancelPurchaseOrder(user.tenantId, user.userId, id, dto);
  }

  // ---- Pickups ----

  @Get('purchase-orders/:id/pickups')
  @RequirePermissions('procurement:read')
  listPickups(
    @CurrentUser() user: AuthContext,
    @Param('id') purchaseOrderId: string,
  ): Promise<PickupRecord[]> {
    return this.procurementService.listPickups(user.tenantId, purchaseOrderId);
  }

  @Get('pickups/:id')
  @RequirePermissions('procurement:read')
  getPickup(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<PickupRecord> {
    return this.procurementService.getPickup(user.tenantId, id);
  }

  @Post('purchase-orders/:id/pickups')
  @RequirePermissions('procurement:write')
  schedulePickup(
    @CurrentUser() user: AuthContext,
    @Param('id') purchaseOrderId: string,
    @Body() dto: SchedulePickupDto,
  ): Promise<PickupRecord> {
    return this.procurementService.schedulePickup(user.tenantId, user.userId, purchaseOrderId, dto);
  }

  @Post('pickups/:id/complete')
  @RequirePermissions('procurement:write')
  completePickup(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: CompletePickupDto,
  ): Promise<PickupRecord> {
    return this.procurementService.completePickup(user.tenantId, user.userId, id, dto);
  }

  @Post('pickups/:id/cancel')
  @RequirePermissions('procurement:write')
  cancelPickup(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ): Promise<PickupRecord> {
    return this.procurementService.cancelPickup(user.tenantId, user.userId, id, dto);
  }

  // ---- Goods receipt / Lots ----

  @Get('purchase-orders/:id/lots')
  @RequirePermissions('procurement:read')
  listLots(
    @CurrentUser() user: AuthContext,
    @Param('id') purchaseOrderId: string,
  ): Promise<LotRecord[]> {
    return this.procurementService.listLots(user.tenantId, purchaseOrderId);
  }

  @Post('purchase-orders/:id/receive-goods')
  @RequirePermissions('procurement:write')
  receiveGoods(
    @CurrentUser() user: AuthContext,
    @Param('id') purchaseOrderId: string,
    @Body() dto: ReceiveGoodsDto,
  ): Promise<LotRecord[]> {
    return this.procurementService.receiveGoods(user.tenantId, user.userId, purchaseOrderId, dto);
  }

  @Post('lots/:id/grade')
  @RequirePermissions('procurement:grade')
  gradeLot(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: GradeLotDto,
  ): Promise<LotRecord> {
    return this.procurementService.gradeLot(user.tenantId, user.userId, id, dto);
  }

  // ---- Farmer settlement ----

  @Get('purchase-orders/:id/settlements')
  @RequirePermissions('procurement:read')
  listSettlements(
    @CurrentUser() user: AuthContext,
    @Param('id') purchaseOrderId: string,
  ): Promise<FarmerSettlementRecord[]> {
    return this.procurementService.listSettlements(user.tenantId, purchaseOrderId);
  }

  @Post('lots/:id/settle')
  @RequirePermissions('procurement:settle')
  settleFarmer(
    @CurrentUser() user: AuthContext,
    @Param('id') lotId: string,
    @Body() dto: SettleFarmerDto,
  ): Promise<FarmerSettlementRecord> {
    return this.procurementService.settleFarmer(user.tenantId, user.userId, lotId, dto);
  }
}
