import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { SpotActor, SpotSalesService } from './spot-sales.service';
import { PriceBand, SpotSaleRecord, SpotSalesSummary, SpotSettings, VehicleStockRow } from './entities/spot-sales.entity';
import { PriceBandDto, RecordSpotSaleDto, SpotDecisionDto, SpotListQueryDto, SpotSettingsDto, SpotSummaryQueryDto } from './dto/spot-sales.dto';
import { PaginatedResult } from '../../common/persistence/pagination';

const actor = (u: AuthContext): SpotActor => ({ tenantId: u.tenantId, userId: u.userId, permissions: u.permissions });

// A driver's login holds spot_sales:record: sells from their own trip and
// sees their own sales (DRV.15, DRV.17). The office holds spot_sales:read
// (every sale, the price bands); spot_sales:configure sets the bands.
// Deciding a price exception is the approval framework's call — role
// limits for 'spot_sale_price', never the person who recorded the sale —
// not a permission code. Reads check the caller's scope in the service,
// since either of two codes may open them.
@ApiTags('spot-sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('spot-sales')
export class SpotSalesController {
  constructor(private readonly spot: SpotSalesService) {}

  @Get('settings')
  @RequirePermissions('spot_sales:read')
  settings(@CurrentUser() user: AuthContext): Promise<SpotSettings> {
    return this.spot.getSettings(user.tenantId);
  }

  @Put('settings')
  @RequirePermissions('spot_sales:configure')
  saveSettings(@CurrentUser() user: AuthContext, @Body() dto: SpotSettingsDto): Promise<SpotSettings> {
    return this.spot.saveSettings(user.tenantId, user.userId, dto);
  }

  @Get('price-bands')
  @RequirePermissions('spot_sales:read')
  bands(@CurrentUser() user: AuthContext, @Query('productId') productId?: string): Promise<PriceBand[]> {
    return this.spot.listBands(user.tenantId, productId);
  }

  @Post('price-bands')
  @RequirePermissions('spot_sales:configure')
  addBand(@CurrentUser() user: AuthContext, @Body() dto: PriceBandDto): Promise<PriceBand[]> {
    return this.spot.addBand(user.tenantId, user.userId, dto);
  }

  /** What the trip's vehicle can sell now, with the price band for each. */
  @Get('trips/:tripId/stock')
  @RequirePermissions('spot_sales:record')
  stock(@CurrentUser() user: AuthContext, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<VehicleStockRow[]> {
    return this.spot.vehicleStock(actor(user), tripId);
  }

  @Get('summary')
  @RequirePermissions('spot_sales:read')
  summary(@CurrentUser() user: AuthContext, @Query() q: SpotSummaryQueryDto): Promise<SpotSalesSummary> {
    return this.spot.summary(actor(user), q.from, q.to);
  }

  @Get()
  list(@CurrentUser() user: AuthContext, @Query() q: SpotListQueryDto): Promise<PaginatedResult<SpotSaleRecord>> {
    return this.spot.list(actor(user), q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<SpotSaleRecord> {
    return this.spot.getSale(actor(user), id);
  }

  @Post()
  @RequirePermissions('spot_sales:record')
  record(@CurrentUser() user: AuthContext, @Body() dto: RecordSpotSaleDto): Promise<SpotSaleRecord> {
    return this.spot.record(actor(user), dto);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('spot_sales:read')
  decide(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SpotDecisionDto): Promise<SpotSaleRecord> {
    return this.spot.decide(actor(user), id, dto.approved, dto.note);
  }

  /** Catches a sale up with a decision made on the Approvals page. */
  @Post(':id/sync')
  @HttpCode(200)
  sync(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<SpotSaleRecord> {
    return this.spot.sync(actor(user), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('spot_sales:record')
  cancel(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<SpotSaleRecord> {
    return this.spot.cancel(actor(user), id);
  }
}
