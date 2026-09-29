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
import { LogisticsService, UploadedPhoto } from './logistics.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { AddPickupStopDto } from './dto/add-pickup-stop.dto';
import { AddDeliveryStopDto } from './dto/add-delivery-stop.dto';
import { VersionDto } from './dto/version.dto';
import { ReorderStopsDto } from './dto/reorder-stops.dto';
import { RecordExpenseDto } from './dto/record-expense.dto';
import { ReconcileTripDto } from './dto/reconcile-trip.dto';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto';
import { UploadPhotoDto } from './dto/upload-photo.dto';
import { RecordCollectionDto } from './dto/record-collection.dto';
import { TripRecord, TripStatus } from './entities/trip.entity';
import { TripStopRecord } from './entities/trip-stop.entity';
import { TripExpenseRecord } from './entities/trip-expense.entity';
import { TripReconciliationRecord } from './entities/trip-reconciliation.entity';
import { TripStopPhotoRecord } from './entities/trip-stop-photo.entity';
import { CustomerCollectionRecord } from './entities/customer-collection.entity';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function isDispatcher(user: AuthContext): boolean {
  return user.permissions.includes('logistics:dispatch');
}

@ApiTags('logistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('logistics/trips')
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

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
    @Body() dto: VersionDto,
  ): Promise<TripRecord> {
    return this.logisticsService.startTrip(user.tenantId, user.userId, isDispatcher(user), id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('logistics:write')
  completeTrip(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: VersionDto,
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
  ): Promise<TripStopRecord> {
    return this.logisticsService.completePickupStop(user.tenantId, user.userId, isDispatcher(user), tripId, stopId);
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
  ): Promise<TripStopRecord> {
    return this.logisticsService.skipStop(user.tenantId, user.userId, isDispatcher(user), tripId, stopId);
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

  // ---- Reconciliation ----

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
