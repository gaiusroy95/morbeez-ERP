import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { FleetService } from './fleet.service';
import { EconomicsReport, FleetSettings, FuelRecord, HireBill, HireSuggestion, LoanView, VehicleDetail, VehicleOverview } from './entities/fleet.entity';
import {
  CapitalizeVehicleDto,
  CreateLoanDto,
  DisposeVehicleDto,
  FleetRangeQueryDto,
  FleetSettingsDto,
  HireBillsQueryDto,
  HireContractDto,
  HireSuggestionQueryDto,
  PayEmiDto,
  PayHireBillDto,
  RecordDocumentDto,
  RecordFuelDto,
  RecordHireBillDto,
  RecordMaintenanceDto,
  RunDepreciationDto,
  VehicleProfileDto,
} from './dto/fleet.dto';

// Vehicle economics under /fleet (the vehicle record itself stays at
// /vehicles). Running a vehicle — fuel, maintenance, documents, whether it's
// owned or hired — is vehicles:write; its books — the asset, depreciation,
// disposal, loans and EMIs, hire rates, bills and their payment — are
// fleet:finance. Anyone with vehicles:read sees it all, and the cost report.
@ApiTags('fleet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fleet')
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('settings')
  @RequirePermissions('vehicles:read')
  settings(@CurrentUser() user: AuthContext): Promise<FleetSettings> {
    return this.fleet.getSettings(user.tenantId);
  }

  @Put('settings')
  @RequirePermissions('vehicles:write')
  saveSettings(@CurrentUser() user: AuthContext, @Body() dto: FleetSettingsDto): Promise<FleetSettings> {
    return this.fleet.saveSettings(user.tenantId, user.userId, dto);
  }

  // ---- Vehicles ----

  @Get('vehicles')
  @RequirePermissions('vehicles:read')
  list(@CurrentUser() user: AuthContext): Promise<VehicleOverview[]> {
    return this.fleet.listVehicles(user.tenantId);
  }

  @Get('vehicles/:id')
  @RequirePermissions('vehicles:read')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<VehicleDetail> {
    return this.fleet.getVehicle(user.tenantId, id);
  }

  @Put('vehicles/:id/profile')
  @RequirePermissions('vehicles:write')
  saveProfile(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VehicleProfileDto): Promise<VehicleDetail> {
    return this.fleet.saveProfile(user.tenantId, user.userId, id, dto);
  }

  // ---- Running costs ----

  @Get('fuel')
  @RequirePermissions('vehicles:read')
  listFuel(@CurrentUser() user: AuthContext, @Query() q: FleetRangeQueryDto): Promise<FuelRecord[]> {
    return this.fleet.listFuel(user.tenantId, q.from, q.to, q.vehicleId);
  }

  @Post('fuel')
  @RequirePermissions('vehicles:write')
  recordFuel(@CurrentUser() user: AuthContext, @Body() dto: RecordFuelDto): Promise<VehicleDetail> {
    return this.fleet.recordFuel(user.tenantId, user.userId, dto);
  }

  @Post('maintenance')
  @RequirePermissions('vehicles:write')
  recordMaintenance(@CurrentUser() user: AuthContext, @Body() dto: RecordMaintenanceDto): Promise<VehicleDetail> {
    return this.fleet.recordMaintenance(user.tenantId, user.userId, dto);
  }

  @Post('documents')
  @RequirePermissions('vehicles:write')
  recordDocument(@CurrentUser() user: AuthContext, @Body() dto: RecordDocumentDto): Promise<VehicleDetail> {
    return this.fleet.recordDocument(user.tenantId, user.userId, dto);
  }

  // ---- The asset ----

  @Get('assets')
  @RequirePermissions('vehicles:read')
  assets(@CurrentUser() user: AuthContext) {
    return this.fleet.listAssets(user.tenantId);
  }

  @Post('vehicles/:id/capitalize')
  @RequirePermissions('fleet:finance')
  capitalize(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CapitalizeVehicleDto): Promise<VehicleDetail> {
    return this.fleet.capitalize(user.tenantId, user.userId, id, dto);
  }

  @Post('depreciation/run')
  @RequirePermissions('fleet:finance')
  runDepreciation(@CurrentUser() user: AuthContext, @Body() dto: RunDepreciationDto) {
    return this.fleet.runDepreciation(user.tenantId, user.userId, dto.throughMonth);
  }

  @Post('vehicles/:id/dispose')
  @RequirePermissions('fleet:finance')
  dispose(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeVehicleDto): Promise<VehicleDetail> {
    return this.fleet.dispose(user.tenantId, user.userId, id, dto);
  }

  // ---- Loans ----

  @Get('loans')
  @RequirePermissions('vehicles:read')
  loans(@CurrentUser() user: AuthContext): Promise<(LoanView & { registrationNumber: string })[]> {
    return this.fleet.listLoans(user.tenantId);
  }

  @Post('loans')
  @RequirePermissions('fleet:finance')
  createLoan(@CurrentUser() user: AuthContext, @Body() dto: CreateLoanDto): Promise<VehicleDetail> {
    return this.fleet.createLoan(user.tenantId, user.userId, dto);
  }

  @Post('loans/:id/payments')
  @RequirePermissions('fleet:finance')
  payEmi(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayEmiDto): Promise<VehicleDetail> {
    return this.fleet.payEmi(user.tenantId, user.userId, id, dto);
  }

  // ---- Hired vehicles ----

  @Post('vehicles/:id/hire-contracts')
  @RequirePermissions('fleet:finance')
  addContract(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HireContractDto): Promise<VehicleDetail> {
    return this.fleet.addHireContract(user.tenantId, user.userId, id, dto);
  }

  @Get('vehicles/:id/hire-suggestion')
  @RequirePermissions('vehicles:read')
  suggestHire(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: HireSuggestionQueryDto): Promise<HireSuggestion> {
    return this.fleet.suggestHire(user.tenantId, id, q.from, q.to);
  }

  @Get('hire-bills')
  @RequirePermissions('vehicles:read')
  hireBills(@CurrentUser() user: AuthContext, @Query() q: HireBillsQueryDto): Promise<HireBill[]> {
    return this.fleet.listHireBills(user.tenantId, q.status, q.vehicleId);
  }

  @Post('hire-bills')
  @RequirePermissions('fleet:finance')
  recordHireBill(@CurrentUser() user: AuthContext, @Body() dto: RecordHireBillDto): Promise<HireBill> {
    return this.fleet.recordHireBill(user.tenantId, user.userId, dto);
  }

  @Post('hire-bills/:id/pay')
  @RequirePermissions('fleet:finance')
  payHireBill(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayHireBillDto): Promise<HireBill> {
    return this.fleet.payHireBill(user.tenantId, user.userId, id, dto);
  }

  // ---- Economics ----

  @Get('economics')
  @RequirePermissions('vehicles:read')
  economics(@CurrentUser() user: AuthContext, @Query() q: FleetRangeQueryDto): Promise<EconomicsReport> {
    return this.fleet.economics(user.tenantId, q.from, q.to);
  }
}
