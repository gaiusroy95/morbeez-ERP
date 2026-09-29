import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { CratesService } from './crates.service';
import { CrateAlert, CrateOverview, CrateSettings, CrateType, HolderDetail, HolderKind, Holding, LossRecord, MovementRecord, TripCrates } from './entities/crates.entity';
import {
  CrateLimitDto,
  CrateSettingsDto,
  CreateCrateTypeDto,
  HoldingsQueryDto,
  MovementsQueryDto,
  RecordLossDto,
  RecordMovementDto,
  ReverseMovementDto,
  StopCountsDto,
  UpdateCrateTypeDto,
} from './dto/crates.dto';

const HOLDER_KINDS: HolderKind[] = ['yard', 'customer', 'farmer', 'vehicle'];

// Seeing crates is crates:read; moving them — issues, returns, loading,
// trip counts, write-offs — crates:write; charging a customer or farmer for
// lost crates crates:charge (it bills or deducts money); crate types,
// costs, limits and alert settings crates:configure.
@ApiTags('crates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('crates')
export class CratesController {
  constructor(private readonly crates: CratesService) {}

  @Get('overview')
  @RequirePermissions('crates:read')
  overview(@CurrentUser() user: AuthContext): Promise<CrateOverview> {
    return this.crates.overview(user.tenantId);
  }

  @Get('alerts')
  @RequirePermissions('crates:read')
  alerts(@CurrentUser() user: AuthContext): Promise<CrateAlert[]> {
    return this.crates.alerts(user.tenantId);
  }

  // ---- Settings, types, limits ----

  @Get('settings')
  @RequirePermissions('crates:read')
  settings(@CurrentUser() user: AuthContext): Promise<CrateSettings> {
    return this.crates.getSettings(user.tenantId);
  }

  @Put('settings')
  @RequirePermissions('crates:configure')
  saveSettings(@CurrentUser() user: AuthContext, @Body() dto: CrateSettingsDto): Promise<CrateSettings> {
    return this.crates.saveSettings(user.tenantId, user.userId, dto);
  }

  @Get('types')
  @RequirePermissions('crates:read')
  types(@CurrentUser() user: AuthContext): Promise<CrateType[]> {
    return this.crates.listTypes(user.tenantId);
  }

  @Post('types')
  @RequirePermissions('crates:configure')
  createType(@CurrentUser() user: AuthContext, @Body() dto: CreateCrateTypeDto): Promise<CrateType[]> {
    return this.crates.createType(user.tenantId, user.userId, dto);
  }

  @Patch('types/:id')
  @RequirePermissions('crates:configure')
  updateType(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCrateTypeDto): Promise<CrateType[]> {
    return this.crates.updateType(user.tenantId, user.userId, id, dto);
  }

  @Put('limits')
  @RequirePermissions('crates:configure')
  setLimit(@CurrentUser() user: AuthContext, @Body() dto: CrateLimitDto): Promise<Holding> {
    return this.crates.setLimit(user.tenantId, user.userId, dto);
  }

  // ---- Balances ----

  @Get('parties')
  @RequirePermissions('crates:read')
  parties(@CurrentUser() user: AuthContext) {
    return this.crates.listParties(user.tenantId);
  }

  @Get('holdings')
  @RequirePermissions('crates:read')
  holdings(@CurrentUser() user: AuthContext, @Query() q: HoldingsQueryDto): Promise<Holding[]> {
    return this.crates.listHoldings(user.tenantId, q.kind);
  }

  @Get('holders/yard')
  @RequirePermissions('crates:read')
  yard(@CurrentUser() user: AuthContext): Promise<HolderDetail> {
    return this.crates.getHolder(user.tenantId, 'yard', null);
  }

  @Get('holders/:kind/:id')
  @RequirePermissions('crates:read')
  holder(@CurrentUser() user: AuthContext, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string): Promise<HolderDetail> {
    if (!HOLDER_KINDS.includes(kind as HolderKind) || kind === 'yard') throw new BadRequestException('kind is customer, farmer or vehicle');
    return this.crates.getHolder(user.tenantId, kind as HolderKind, id);
  }

  // ---- Movements ----

  @Get('movements')
  @RequirePermissions('crates:read')
  movements(@CurrentUser() user: AuthContext, @Query() q: MovementsQueryDto): Promise<MovementRecord[]> {
    return this.crates.listMovements(user.tenantId, q);
  }

  @Post('movements')
  @RequirePermissions('crates:write')
  recordMovement(@CurrentUser() user: AuthContext, @Body() dto: RecordMovementDto): Promise<MovementRecord[]> {
    return this.crates.recordMovement(user.tenantId, user.userId, dto);
  }

  @Post('movements/:id/reverse')
  @RequirePermissions('crates:write')
  reverse(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseMovementDto): Promise<MovementRecord> {
    return this.crates.reverseMovement(user.tenantId, user.userId, id, dto.reason);
  }

  // ---- Losses ----

  @Get('losses')
  @RequirePermissions('crates:read')
  losses(@CurrentUser() user: AuthContext, @Query() q: MovementsQueryDto): Promise<LossRecord[]> {
    return this.crates.listLosses(user.tenantId, q.from, q.to);
  }

  /** Written off, nothing charged. */
  @Post('losses')
  @RequirePermissions('crates:write')
  recordLoss(@CurrentUser() user: AuthContext, @Body() dto: RecordLossDto): Promise<LossRecord> {
    return this.crates.recordLoss(user.tenantId, user.userId, dto, 'absorbed');
  }

  /** Written off and charged to the customer or farmer who lost them. */
  @Post('losses/charge')
  @RequirePermissions('crates:charge')
  chargeLoss(@CurrentUser() user: AuthContext, @Body() dto: RecordLossDto): Promise<LossRecord> {
    return this.crates.recordLoss(user.tenantId, user.userId, dto, 'charge');
  }

  // ---- Trips ----

  @Get('trips/:tripId')
  @RequirePermissions('crates:read')
  trip(@CurrentUser() user: AuthContext, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<TripCrates> {
    return this.crates.getTrip(user.tenantId, tripId);
  }

  @Post('trips/:tripId/stops/:stopId')
  @RequirePermissions('crates:write')
  stopCounts(
    @CurrentUser() user: AuthContext,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: StopCountsDto,
  ): Promise<TripCrates> {
    return this.crates.recordStopCounts(user.tenantId, user.userId, tripId, stopId, dto);
  }
}
