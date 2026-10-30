import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { idempotencyKey } from '../../common/idempotency';
import { AuthContext } from '../../common/types/auth-context';
import { ListTripsQueryDto } from './dto/list-trips-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { LogisticsService, TripReview, UploadedPhoto } from './logistics.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { AddPickupStopDto } from './dto/add-pickup-stop.dto';
import { AddDeliveryStopDto } from './dto/add-delivery-stop.dto';
import { VersionDto } from './dto/version.dto';
import { ReorderStopsDto } from './dto/reorder-stops.dto';
import { DecideExpenseDto, RecordExpenseDto, UploadExpensePhotoDto } from './dto/record-expense.dto';
import { ReconcileTripDto } from './dto/reconcile-trip.dto';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto';
import { UploadPhotoDto } from './dto/upload-photo.dto';
import { RaiseStopDisputeDto, ReturnTripDto } from './dto/return-trip.dto';
import { TripCollections } from './entities/trip-collections.entity';
import { InvoiceDispute } from '../finance/disputes.service';
import { RecordCollectionDto } from './dto/record-collection.dto';
import { TripRecord } from './entities/trip.entity';
import { TripStopRecord } from './entities/trip-stop.entity';
import { TripExpensePhotoRecord, TripExpenseRecord } from './entities/trip-expense.entity';
import { TripReconciliationRecord } from './entities/trip-reconciliation.entity';
import { TripStopPhotoRecord } from './entities/trip-stop-photo.entity';
import { CustomerCollectionRecord } from './entities/customer-collection.entity';
import { TripCashDepositRecord } from './entities/trip-cash-deposit.entity';
import { SubmitTripDto } from './dto/submit-trip.dto';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { TripDecisionDto } from './dto/trip-decision.dto';
import { ReviewTripQueryDto } from './dto/review-trip-query.dto';
import { HandoverSummary } from './trip-closure';
import { SkipStopDto } from './dto/skip-stop.dto';
import { CompletePickupStopDto } from './dto/complete-pickup-stop.dto';
import { ReportProblemDto } from './dto/report-problem.dto';
import { Authority } from './delegation';
import { TripPlanQueryDto, TripsBoardQueryDto } from './dto/trip-planning.dto';
import { DriverDay, OnTheRoad, TripPlan, TripQuantities, TripsBoard, TripVehicleStock, VehicleTrips } from './entities/trip-planning.entity';
import { StartTripDto } from './dto/start-trip.dto';
import { DriverRecordsService } from './driver-records.service';
import { DriverRangeQueryDto, EarningsQueryDto } from './dto/driver-records.dto';
import {
  DriverApprovals,
  DriverProfile,
  DriverSettlement,
  DriverTripSummary,
  MyEarnings,
  MyExpenses,
  MyVehicle,
  TripHistory,
  TripIncentives,
} from './entities/driver-records.entity';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function isDispatcher(user: AuthContext): boolean {
  return user.permissions.includes('logistics:dispatch');
}

@ApiTags('logistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('logistics/trips')
export class LogisticsController {
  constructor(
    private readonly logisticsService: LogisticsService,
    private readonly driverRecords: DriverRecordsService,
  ) {}

  // ---- Trips ----

  @Get()
  @RequirePermissions('logistics:dispatch')
  listTrips(
    @CurrentUser() user: AuthContext,
    @Query() query: ListTripsQueryDto,
  ): Promise<PaginatedResult<TripRecord>> {
    return this.logisticsService.listTrips(user.tenantId, query.status, query.page ?? 1, query.pageSize ?? 25);
  }

  /** A driver's own trips — never a client-supplied filter (Driver App Architecture, DRV.14). */
  @Get('mine')
  @RequirePermissions('logistics:read')
  listMyTrips(
    @CurrentUser() user: AuthContext,
    @Query() query: ListTripsQueryDto,
  ): Promise<PaginatedResult<TripRecord>> {
    return this.logisticsService.listMyTrips(user.tenantId, user.userId, query.status, query.page ?? 1, query.pageSize ?? 25);
  }

  /** The driver's day: today's trip, its vehicle and last odometer reading, this week's earnings, vehicle stock (driver app D1). */
  @Get('mine/day')
  @RequirePermissions('logistics:read')
  myDay(@CurrentUser() user: AuthContext): Promise<DriverDay> {
    return this.logisticsService.getDriverDay(user.tenantId, user.userId);
  }

  // ---- The driver's own records (driver app D6) ----

  /** My Expenses: what the driver spent, and the vehicle's mileage. */
  @Get('mine/expenses')
  @RequirePermissions('logistics:read')
  myExpenses(@CurrentUser() user: AuthContext, @Query() q: DriverRangeQueryDto): Promise<MyExpenses> {
    return this.driverRecords.myExpenses(user.tenantId, user.userId, q.from, q.to);
  }

  /** What the driver raised that the owner decides: expenses, disputes, handovers. */
  @Get('mine/approvals')
  @RequirePermissions('logistics:read')
  myApprovals(@CurrentUser() user: AuthContext): Promise<DriverApprovals> {
    return this.driverRecords.myApprovals(user.tenantId, user.userId);
  }

  /** Trip History: the driver's past trips, each with what it did. */
  @Get('mine/history')
  @RequirePermissions('logistics:read')
  myHistory(@CurrentUser() user: AuthContext, @Query() q: DriverRangeQueryDto): Promise<TripHistory> {
    return this.driverRecords.myHistory(user.tenantId, user.userId, q.from, q.to);
  }

  /** The vehicle the driver drives: what's due, what's in force, its mileage. None before their first trip. */
  @Get('mine/vehicle')
  @RequirePermissions('logistics:read')
  async myVehicle(@CurrentUser() user: AuthContext): Promise<MyVehicle> {
    return { vehicle: await this.driverRecords.myVehicle(user.tenantId, user.userId) };
  }

  /** My Earnings (D7): fixed pay and each incentive — today, this week or this month. */
  @Get('mine/earnings')
  @RequirePermissions('logistics:read')
  myEarnings(@CurrentUser() user: AuthContext, @Query() q: EarningsQueryDto): Promise<MyEarnings> {
    return this.driverRecords.myEarnings(user.tenantId, user.userId, q.period ?? 'today');
  }

  /** The driver's weekly pay: approved and paid settlements. */
  @Get('mine/settlements')
  @RequirePermissions('logistics:read')
  mySettlements(@CurrentUser() user: AuthContext): Promise<DriverSettlement[]> {
    return this.driverRecords.mySettlements(user.tenantId, user.userId);
  }

  /** "I received it": the driver confirms a paid settlement reached them. */
  @Post('mine/settlements/:settlementId/received')
  @RequirePermissions('logistics:write')
  acknowledgeSettlement(@CurrentUser() user: AuthContext, @Param('settlementId', ParseUUIDPipe) settlementId: string): Promise<DriverSettlement> {
    return this.driverRecords.acknowledgeSettlement(user.tenantId, user.userId, settlementId);
  }

  @Get('mine/profile')
  @RequirePermissions('logistics:read')
  myProfile(@CurrentUser() user: AuthContext): Promise<DriverProfile> {
    return this.driverRecords.myProfile(user.tenantId, user.userId);
  }

  /** Trips on the road now and their crew: who is on a trip, which vehicles are out (redesign Phase 7). */
  @Get('on-the-road')
  @RequirePermissions('logistics:dispatch')
  onTheRoad(@CurrentUser() user: AuthContext): Promise<OnTheRoad[]> {
    return this.logisticsService.onTheRoad(user.tenantId);
  }

  /** A vehicle's trips: totals, its latest crew and trips (Vehicle details, redesign Phase 7). */
  @Get('vehicles/:vehicleId')
  @RequirePermissions('logistics:dispatch')
  vehicleTrips(@CurrentUser() user: AuthContext, @Param('vehicleId', ParseUUIDPipe) vehicleId: string): Promise<VehicleTrips> {
    return this.logisticsService.vehicleTrips(user.tenantId, vehicleId);
  }

  /** The owner's Trips list: Today / Tomorrow / All, with search (redesign V1.1). */
  @Get('board')
  @RequirePermissions('logistics:dispatch')
  board(@CurrentUser() user: AuthContext, @Query() query: TripsBoardQueryDto): Promise<TripsBoard> {
    return this.logisticsService.getBoard(user.tenantId, query.day ?? 'today', query.q ?? null, query.page ?? 1, query.pageSize ?? 50);
  }

  /** "Create Trip": what a trip on a day along a route could carry, and the vehicle's capacity and stock. */
  @Get('plan')
  @RequirePermissions('logistics:dispatch')
  plan(@CurrentUser() user: AuthContext, @Query() query: TripPlanQueryDto): Promise<TripPlan> {
    return this.logisticsService.getPlan(user.tenantId, query.date, query.routeId ?? null, query.vehicleId ?? null);
  }

  @Get(':id')
  @RequirePermissions('logistics:read')
  getTrip(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<TripRecord> {
    return this.logisticsService.getTrip(user.tenantId, user.userId, isDispatcher(user), id);
  }

  @Post()
  @RequirePermissions('logistics:dispatch')
  createTrip(@CurrentUser() user: AuthContext, @Body() dto: CreateTripDto): Promise<TripRecord> {
    return this.logisticsService.createTrip(user.tenantId, user.userId, dto);
  }

  @Post(':id/start')
  @RequirePermissions('logistics:write')
  startTrip(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: StartTripDto,
  ): Promise<TripRecord> {
    return this.logisticsService.startTrip(user.tenantId, user.userId, isDispatcher(user), id, dto);
  }

  /** The driver submits the trip: completed, awaiting the owner's reconciliation. */
  @Post(':id/complete')
  @RequirePermissions('logistics:write')
  completeTrip(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SubmitTripDto,
  ): Promise<TripRecord> {
    return this.logisticsService.completeTrip(user.tenantId, user.userId, isDispatcher(user), id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('logistics:write')
  cancelTrip(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ): Promise<TripRecord> {
    return this.logisticsService.cancelTrip(user.tenantId, user.userId, isDispatcher(user), id, dto);
  }

  // ---- Route: stops ----

  /** Product by product: loaded, picked up, delivered, came back, and what should be on the vehicle. */
  /** Trip Details (driver app D6): one trip in full, its stops, collections, backhauls and expenses. */
  @Get(':id/summary')
  @RequirePermissions('logistics:read')
  tripSummary(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string): Promise<DriverTripSummary> {
    return this.driverRecords.tripSummary(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  /** What the driver earned on the trip (D7): kept at the owner's close, else an estimate. */
  @Get(':id/incentives')
  @RequirePermissions('logistics:read')
  tripIncentives(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string): Promise<TripIncentives> {
    return this.driverRecords.tripIncentives(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  @Get(':id/quantities')
  @RequirePermissions('logistics:read')
  quantities(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string): Promise<TripQuantities> {
    return this.logisticsService.getQuantities(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  /** What's on the trip's vehicle now, against what its pending deliveries need. */
  @Get(':id/vehicle-stock')
  @RequirePermissions('logistics:read')
  vehicleStock(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string): Promise<TripVehicleStock> {
    return this.logisticsService.getVehicleStock(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  @Get(':id/stops')
  @RequirePermissions('logistics:read')
  listStops(@CurrentUser() user: AuthContext, @Param('id') tripId: string): Promise<TripStopRecord[]> {
    return this.logisticsService.listStops(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  @Post(':id/stops/pickup')
  @RequirePermissions('logistics:dispatch')
  addPickupStop(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Body() dto: AddPickupStopDto,
  ): Promise<TripStopRecord> {
    return this.logisticsService.addPickupStop(user.tenantId, user.userId, tripId, dto);
  }

  @Put(':id/stops/order')
  @RequirePermissions('logistics:dispatch')
  reorderStops(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Body() dto: ReorderStopsDto,
  ): Promise<TripStopRecord[]> {
    return this.logisticsService.reorderStops(user.tenantId, user.userId, tripId, dto.version, dto.stopIds);
  }

  @Post(':id/stops/delivery')
  @RequirePermissions('logistics:dispatch')
  addDeliveryStop(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Body() dto: AddDeliveryStopDto,
  ): Promise<TripStopRecord> {
    return this.logisticsService.addDeliveryStop(user.tenantId, user.userId, tripId, dto);
  }

  @Post(':id/stops/:stopId/complete-pickup')
  @RequirePermissions('logistics:write')
  completePickupStop(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
    @Body() dto: CompletePickupStopDto,
  ): Promise<TripStopRecord> {
    return this.logisticsService.completePickupStop(user.tenantId, user.userId, isDispatcher(user), tripId, stopId, dto ?? {});
  }

  /** Return (driver app D4): the closing KM when the vehicle is back. (':id/return' is the owner sending a trip back to the driver.) */
  @Post(':id/closing-km')
  @RequirePermissions('logistics:write')
  returnTrip(@CurrentUser() user: AuthContext, @Param('id') tripId: string, @Body() dto: ReturnTripDto): Promise<TripRecord> {
    return this.logisticsService.returnTrip(user.tenantId, user.userId, isDispatcher(user), tripId, dto);
  }

  /** Collections (driver app D4): the customers delivered on the trip, with what each owes in all. */
  @Get(':id/collections')
  @RequirePermissions('logistics:read')
  tripCollections(@CurrentUser() user: AuthContext, @Param('id') tripId: string): Promise<TripCollections> {
    return this.logisticsService.getTripCollections(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  /** A customer disputes part of what they owe (driver app D4): it goes to the owner. */
  @Post(':id/stops/:stopId/disputes')
  @RequirePermissions('logistics:write')
  raiseStopDispute(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
    @Body() dto: RaiseStopDisputeDto,
  ): Promise<InvoiceDispute> {
    return this.logisticsService.raiseStopDispute(user.tenantId, user.userId, isDispatcher(user), tripId, stopId, dto);
  }

  /** Start Trip (driver app D3): the delivery run sets off. */
  @Post(':id/start-deliveries')
  @RequirePermissions('logistics:write')
  startDeliveries(@CurrentUser() user: AuthContext, @Param('id') tripId: string): Promise<TripRecord> {
    return this.logisticsService.startDeliveries(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  /** The driver reached the stop (driver app D2: Start pickup). */
  @Post(':id/stops/:stopId/arrive')
  @RequirePermissions('logistics:write')
  arriveAtStop(@CurrentUser() user: AuthContext, @Param('id') tripId: string, @Param('stopId') stopId: string): Promise<TripStopRecord> {
    return this.logisticsService.arriveAtStop(user.tenantId, user.userId, isDispatcher(user), tripId, stopId);
  }

  @Post(':id/stops/:stopId/complete-delivery')
  @RequirePermissions('logistics:write')
  completeDeliveryStop(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
    @Body() dto: CompleteDeliveryDto,
  ): Promise<TripStopRecord> {
    return this.logisticsService.completeDeliveryStop(
      user.tenantId,
      user.userId,
      isDispatcher(user),
      tripId,
      stopId,
      dto,
    );
  }

  @Post(':id/stops/:stopId/skip')
  @RequirePermissions('logistics:write')
  skipStop(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
    @Body() dto: SkipStopDto,
  ): Promise<TripStopRecord> {
    return this.logisticsService.skipStop(user.tenantId, user.userId, isDispatcher(user), tripId, stopId, dto?.reason ?? null);
  }

  // ---- Photos ----

  @Get(':id/stops/:stopId/photos')
  @RequirePermissions('logistics:read')
  listPhotos(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
  ): Promise<TripStopPhotoRecord[]> {
    return this.logisticsService.listPhotos(user.tenantId, user.userId, isDispatcher(user), tripId, stopId);
  }

  @Post(':id/stops/:stopId/photos')
  @RequirePermissions('logistics:write')
  @ApiConsumes('multipart/form-data')
  // No `storage`/`dest` means multer keeps the upload in memory, so
  // file.buffer is populated for LogisticsService.addPhoto to write.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  uploadPhoto(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
    @Body() dto: UploadPhotoDto,
    @UploadedFile() file?: UploadedPhoto,
  ): Promise<TripStopPhotoRecord> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.logisticsService.addPhoto(
      user.tenantId,
      user.userId,
      isDispatcher(user),
      tripId,
      stopId,
      dto.photoType,
      file,
      dto.productId ?? null,
    );
  }

  // ---- Expenses ----

  @Get(':id/expenses')
  @RequirePermissions('logistics:read')
  listExpenses(@CurrentUser() user: AuthContext, @Param('id') tripId: string): Promise<TripExpenseRecord[]> {
    return this.logisticsService.listExpenses(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  @Post(':id/expenses')
  @RequirePermissions('logistics:write')
  recordExpense(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Body() dto: RecordExpenseDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<TripExpenseRecord> {
    return this.logisticsService.recordExpense(user.tenantId, user.userId, isDispatcher(user), tripId, dto, idempotencyKey(key));
  }

  /** The bill, kept with the expense (driver app D6). */
  @Post(':id/expenses/:expenseId/photos')
  @RequirePermissions('logistics:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  uploadExpensePhoto(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() _dto: UploadExpensePhotoDto,
    @UploadedFile() file?: UploadedPhoto,
  ): Promise<TripExpensePhotoRecord> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.logisticsService.addExpensePhoto(user.tenantId, user.userId, isDispatcher(user), tripId, expenseId, file);
  }

  /** The owner approves or rejects an expense beyond the driver's authority (Approvals inbox). */
  @Post(':id/expenses/:expenseId/decision')
  @RequirePermissions('logistics:reconcile')
  decideExpense(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() dto: DecideExpenseDto,
  ): Promise<TripExpenseRecord> {
    return this.logisticsService.decideExpense(user.tenantId, user.userId, tripId, expenseId, dto);
  }

  // ---- Collections ----

  @Get(':id/stops/:stopId/collections')
  @RequirePermissions('logistics:read')
  listCollections(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
  ): Promise<CustomerCollectionRecord[]> {
    return this.logisticsService.listCollections(user.tenantId, user.userId, isDispatcher(user), tripId, stopId);
  }

  @Post(':id/stops/:stopId/collections')
  @RequirePermissions('logistics:write')
  recordCollection(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Param('stopId') stopId: string,
    @Body() dto: RecordCollectionDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<CustomerCollectionRecord> {
    return this.logisticsService.recordCollection(
      user.tenantId,
      user.userId,
      isDispatcher(user),
      tripId,
      stopId,
      dto,
      idempotencyKey(key),
    );
  }

  // ---- Handover ----

  @Get(':id/deposits')
  @RequirePermissions('logistics:read')
  listDeposits(@CurrentUser() user: AuthContext, @Param('id') tripId: string): Promise<TripCashDepositRecord[]> {
    return this.logisticsService.listDeposits(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  @Post(':id/deposits')
  @RequirePermissions('logistics:write')
  recordDeposit(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Body() dto: RecordDepositDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<TripCashDepositRecord> {
    return this.logisticsService.recordDeposit(user.tenantId, user.userId, isDispatcher(user), tripId, dto, idempotencyKey(key));
  }

  /** What the driver should hand over: the driver's own trip, or any trip for the owner. */
  @Get(':id/handover')
  @RequirePermissions('logistics:read')
  getHandover(@CurrentUser() user: AuthContext, @Param('id') tripId: string): Promise<HandoverSummary> {
    return this.logisticsService.getHandover(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  /** What this trip's driver may do on it right now (delegation level and where it comes from). */
  @Get(':id/authority')
  @RequirePermissions('logistics:read')
  getAuthority(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string): Promise<Authority> {
    return this.logisticsService.getAuthority(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  /** The driver tells the owner something that can't wait — an immediate alert. */
  @Post(':id/problem')
  @RequirePermissions('logistics:write')
  reportProblem(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Body() dto: ReportProblemDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<{ reported: true }> {
    return this.logisticsService.reportProblem(user.tenantId, user.userId, isDispatcher(user), tripId, dto, idempotencyKey(key));
  }

  // ---- Reconciliation (the owner) ----

  @Get(':id/review')
  @RequirePermissions('logistics:reconcile')
  reviewTrip(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Query() query: ReviewTripQueryDto,
  ): Promise<TripReview> {
    return this.logisticsService.reviewTrip(user.tenantId, tripId, query.cashReceived ?? null);
  }

  @Post(':id/hold')
  @RequirePermissions('logistics:reconcile')
  holdTrip(@CurrentUser() user: AuthContext, @Param('id') tripId: string, @Body() dto: TripDecisionDto): Promise<TripRecord> {
    return this.logisticsService.holdTrip(user.tenantId, user.userId, tripId, dto);
  }

  @Post(':id/return')
  @RequirePermissions('logistics:reconcile')
  returnToDriver(@CurrentUser() user: AuthContext, @Param('id') tripId: string, @Body() dto: TripDecisionDto): Promise<TripRecord> {
    return this.logisticsService.returnToDriver(user.tenantId, user.userId, tripId, dto);
  }

  @Get(':id/reconciliation')
  @RequirePermissions('logistics:read')
  getReconciliation(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
  ): Promise<TripReconciliationRecord | null> {
    return this.logisticsService.getReconciliation(user.tenantId, tripId);
  }

  @Post(':id/reconcile')
  @RequirePermissions('logistics:reconcile')
  reconcileTrip(
    @CurrentUser() user: AuthContext,
    @Param('id') tripId: string,
    @Body() dto: ReconcileTripDto,
  ): Promise<TripReconciliationRecord> {
    return this.logisticsService.reconcileTrip(user.tenantId, user.userId, tripId, dto);
  }
}
