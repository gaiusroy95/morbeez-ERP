import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { FleetService } from '../vehicles/fleet.service';
import { WorkforceService } from '../workforce/workforce.service';
import { PayrollService } from '../workforce/payroll.service';
import { ProcurementService } from '../procurement/procurement.service';
import { OrdersService } from '../orders/orders.service';
import { ReceivablesService } from '../finance/receivables.service';
import { LedgerService } from '../finance/ledger.service';
import { TripsRepository } from './repositories/trips.repository';
import { TripStopsRepository } from './repositories/trip-stops.repository';
import { TripExpensesRepository } from './repositories/trip-expenses.repository';
import { TripReconciliationsRepository } from './repositories/trip-reconciliations.repository';
import { TripStopPhotosRepository } from './repositories/trip-stop-photos.repository';
import { TripStopPodsRepository } from './repositories/trip-stop-pods.repository';
import { CustomerCollectionsRepository } from './repositories/customer-collections.repository';
import { TripRecord, TripStatus } from './entities/trip.entity';
import { TripStopRecord } from './entities/trip-stop.entity';
import { TripExpenseRecord } from './entities/trip-expense.entity';
import { TripReconciliationRecord } from './entities/trip-reconciliation.entity';
import { PhotoType, TripStopPhotoRecord } from './entities/trip-stop-photo.entity';
import { TripStopPodRecord } from './entities/trip-stop-pod.entity';
import { CustomerCollectionRecord } from './entities/customer-collection.entity';
import { clampPageSize, PaginatedResult } from '../../common/persistence/pagination';
import { once } from '../../common/idempotency';
import { toCents } from '../../common/money';
import { CreateTripDto } from './dto/create-trip.dto';
import { AddPickupStopDto } from './dto/add-pickup-stop.dto';
import { AddDeliveryStopDto } from './dto/add-delivery-stop.dto';
import { VersionDto } from './dto/version.dto';
import { RecordExpenseDto } from './dto/record-expense.dto';
import { ReconcileTripDto } from './dto/reconcile-trip.dto';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto';
import { RecordCollectionDto } from './dto/record-collection.dto';

const TRIP_ENTITY = 'trip';
const STOP_ENTITY = 'trip_stop';

const VALID_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Injectable()
export class LogisticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: ObjectStorageService,
    private readonly trips: TripsRepository,
    private readonly stops: TripStopsRepository,
    private readonly expenses: TripExpensesRepository,
    private readonly reconciliations: TripReconciliationsRepository,
    private readonly photos: TripStopPhotosRepository,
    private readonly pods: TripStopPodsRepository,
    private readonly collections: CustomerCollectionsRepository,
    private readonly vehicles: VehiclesService,
    private readonly workforce: WorkforceService,
    private readonly procurement: ProcurementService,
    private readonly orders: OrdersService,
    private readonly receivables: ReceivablesService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly payroll: PayrollService,
    private readonly fleet: FleetService,
  ) {}

  // ---- Trips ----

  /** Dispatch-only — every driver's trips, tenant-wide. */
  listTrips(
    tenantId: string,
    status: TripStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<TripRecord>> {
    return this.trips.list(tenantId, status, page, pageSize);
  }

  /** A driver's own trips only — resolved from their own login, never a client-supplied filter. */
  async listMyTrips(
    tenantId: string,
    actorUserId: string,
    status: TripStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<TripRecord>> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, actorUserId);
    if (!employeeId) {
      return { items: [], total: 0, page: Math.max(page, 1), pageSize: clampPageSize(pageSize) };
    }
    return this.trips.listForDriver(tenantId, employeeId, status, page, pageSize);
  }

  /**
   * Trip-ownership is enforced independently of the permission code
   * (Driver App Architecture, DRV.15): logistics:write says a role may act
   * on trips in general, not on this one. A caller holding
   * logistics:dispatch bypasses the check — that permission is exactly
   * "may act on any trip." Everyone else must be the trip's own assigned
   * driver, resolved server-side from their own login, never trusted from
   * client input.
   */
  async getTrip(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    id: string,
  ): Promise<TripRecord> {
    const trip = await this.findTripOrThrow(tenantId, id);
    await this.assertOwnership(tenantId, actorUserId, callerIsDispatcher, trip);
    return trip;
  }

  private async findTripOrThrow(tenantId: string, id: string): Promise<TripRecord> {
    const trip = await this.trips.findById(tenantId, id);
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  private async assertOwnership(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    trip: TripRecord,
  ): Promise<void> {
    if (callerIsDispatcher) return;
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, actorUserId);
    if (!employeeId || employeeId !== trip.driverEmployeeId) {
      throw new ForbiddenException('You may only act on your own trips');
    }
  }

  /** Dispatch-only: creates a trip for any vehicle/driver in the tenant. */
  async createTrip(tenantId: string, actorUserId: string, dto: CreateTripDto): Promise<TripRecord> {
    const vehicle = await this.vehicles.getById(tenantId, dto.vehicleId);
    if (vehicle.status !== 'active') {
      throw new ConflictException(`Vehicle is not active (status: ${vehicle.status})`);
    }
    const driver = await this.workforce.getById(tenantId, dto.driverEmployeeId);
    if (driver.status !== 'active') {
      throw new ConflictException('Driver is not active');
    }
    if (driver.roleType !== 'driver') {
      throw new BadRequestException('The assigned employee is not a driver');
    }

    return this.db.withTenant(tenantId, async (client) => {
      // An expired insurance, PUC, fitness or permit keeps it off the road.
      await this.fleet.assertRoadworthyWithClient(client, dto.vehicleId);
      const trip = await this.trips.createWithClient(client, tenantId, actorUserId, {
        vehicleId: dto.vehicleId,
        driverEmployeeId: dto.driverEmployeeId,
        plannedDate: dto.plannedDate ?? null,
        advanceAmount: dto.advanceAmount ?? 0,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: TRIP_ENTITY,
        entityId: trip.id,
        after: trip as unknown as Record<string, unknown>,
      });
      return trip;
    });
  }

  async startTrip(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    id: string,
    dto: VersionDto,
  ): Promise<TripRecord> {
    const before = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, id);

    return this.db.withTenant(tenantId, async (client) => {
      const stopCount = await this.stops.countWithClient(client, id);
      if (stopCount === 0) {
        throw new ConflictException('Cannot start a trip with no stops on its route');
      }
      // Checked again on departure: a document can lapse between planning and leaving.
      await this.fleet.assertRoadworthyWithClient(client, before.vehicleId);

      const after = await this.trips.startWithClient(client, id, dto.version);
      // The driver leaves with the advance now — it moves to "Cash with drivers".
      await this.ledger.postTripAdvanceWithClient(client, tenantId, actorUserId, {
        id,
        advanceAmount: after.advanceAmount,
        occurredAt: after.startedAt ?? new Date(),
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * Requires every stop to already be 'completed' or 'skipped' — a
   * deliberate dispatcher/driver action once the whole route is done, not
   * something auto-derived the moment the last stop finishes.
   */
  async completeTrip(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    id: string,
    dto: VersionDto,
  ): Promise<TripRecord> {
    const before = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, id);

    return this.db.withTenant(tenantId, async (client) => {
      const pending = await this.stops.countPendingWithClient(client, id);
      if (pending > 0) {
        throw new ConflictException(`${pending} stop(s) on this trip are still pending`);
      }

      const after = await this.trips.completeWithClient(client, id, dto.version);
      // The driver's day of work, for their pay (Workforce), with the trip.
      await this.payroll.recordTripWorkWithClient(client, tenantId, actorUserId, id);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * A cancelled trip's stops are left exactly as they were — any pickup or
   * order they pointed at stays scheduled/confirmed, ready to be attached
   * to a new trip's route. Cancelling here never reaches into Procurement
   * or Orders.
   */
  async cancelTrip(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    id: string,
    dto: VersionDto,
  ): Promise<TripRecord> {
    const before = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, id);

    return this.db.withTenant(tenantId, async (client) => {
      const after = await this.trips.cancelWithClient(client, id, dto.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Route: stops ----

  async listStops(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
  ): Promise<TripStopRecord[]> {
    await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return this.db.withTenant(tenantId, async (client) => {
      const stops = await this.stops.listByTripWithClient(client, tripId);
      const details = await this.stops.detailsForTripWithClient(client, tripId);
      return stops.map((s) => ({ ...s, party: details.get(s.id)?.party ?? null, items: details.get(s.id)?.items ?? [] }));
    });
  }

  /** Dispatch-only: attaches an already-scheduled Procurement pickup to this trip's route. */
  async addPickupStop(
    tenantId: string,
    actorUserId: string,
    tripId: string,
    dto: AddPickupStopDto,
  ): Promise<TripStopRecord> {
    const trip = await this.findTripOrThrow(tenantId, tripId);
    if (trip.status !== 'planned') {
      throw new ConflictException('Stops can only be added to a trip that is still planned');
    }

    const pickup = await this.procurement.getPickup(tenantId, dto.pickupId);
    if (pickup.status !== 'scheduled') {
      throw new ConflictException(`Pickup is not scheduled (status: ${pickup.status})`);
    }

    return this.db.withTenant(tenantId, async (client) => {
      const sequenceNumber = dto.sequenceNumber ?? (await this.stops.nextSequenceNumberWithClient(client, tripId));
      const stop = await this.stops.createWithClient(client, {
        tripId,
        sequenceNumber,
        stopType: 'pickup',
        pickupId: dto.pickupId,
        orderId: null,
        notes: dto.notes ?? null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: STOP_ENTITY,
        entityId: stop.id,
        after: stop as unknown as Record<string, unknown>,
      });
      return stop;
    });
  }

  /** Dispatch-only: attaches a confirmed customer order to this trip's route. */
  async addDeliveryStop(
    tenantId: string,
    actorUserId: string,
    tripId: string,
    dto: AddDeliveryStopDto,
  ): Promise<TripStopRecord> {
    const trip = await this.findTripOrThrow(tenantId, tripId);
    if (trip.status !== 'planned') {
      throw new ConflictException('Stops can only be added to a trip that is still planned');
    }

    const order = await this.orders.getOrder(tenantId, dto.orderId);
    if (order.status !== 'confirmed') {
      throw new ConflictException(`Order is not confirmed (status: ${order.status})`);
    }

    return this.db.withTenant(tenantId, async (client) => {
      const sequenceNumber = dto.sequenceNumber ?? (await this.stops.nextSequenceNumberWithClient(client, tripId));
      const stop = await this.stops.createWithClient(client, {
        tripId,
        sequenceNumber,
        stopType: 'delivery',
        pickupId: null,
        orderId: dto.orderId,
        notes: dto.notes ?? null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: STOP_ENTITY,
        entityId: stop.id,
        after: stop as unknown as Record<string, unknown>,
      });
      return stop;
    });
  }

  /**
   * Dispatch-only: puts a planned trip's stops in a new order — every stop
   * exactly once. The trip's version moves on, so a stale plan can't
   * overwrite a newer one.
   */
  async reorderStops(tenantId: string, actorUserId: string, tripId: string, version: number, stopIds: string[]): Promise<TripStopRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const trip = await this.trips.findByIdWithClient(client, tripId);
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status !== 'planned') throw new ConflictException('Stops can only be reordered while the trip is still planned');
      if (trip.version !== version) throw new ConflictException('This trip was changed by someone else — reload and try again');
      const before = await this.stops.listByTripWithClient(client, tripId);
      const current = new Set(before.map((s) => s.id));
      if (stopIds.length !== current.size || new Set(stopIds).size !== stopIds.length || !stopIds.every((id) => current.has(id))) {
        throw new BadRequestException("Give every one of the trip's stops, each once");
      }
      await this.stops.resequenceWithClient(client, tripId, stopIds);
      const bumped = await client.query('UPDATE fulfilment.trip SET version = version + 1, updated_at = now() WHERE id = $1 AND version = $2', [tripId, version]);
      if (!bumped.rowCount) throw new ConflictException('This trip was changed by someone else — reload and try again');
      const after = await this.stops.listByTripWithClient(client, tripId);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: tripId,
        before: { stopOrder: before.map((s) => s.id) },
        after: { stopOrder: after.map((s) => s.id) },
      });
      return after;
    });
  }

  /**
   * Completing a pickup stop completes the underlying Procurement pickup
   * with this trip's own vehicle and driver — the caller never repeats
   * them (Constitution I.3-I.4: Procurement's public completePickup, never
   * its repository).
   */
  async completePickupStop(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
  ): Promise<TripStopRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    if (trip.status !== 'in_progress') {
      throw new ConflictException('The trip must be in progress to complete a stop');
    }

    const stop = await this.getStopOnTrip(tenantId, tripId, stopId);
    if (stop.stopType !== 'pickup') throw new BadRequestException('This stop is not a pickup');
    if (stop.status !== 'pending') throw new ConflictException(`Stop is already ${stop.status}`);

    const pickup = await this.procurement.getPickup(tenantId, stop.pickupId as string);
    await this.procurement.completePickup(tenantId, actorUserId, pickup.id, {
      version: pickup.version,
      vehicleId: trip.vehicleId,
      driverEmployeeId: trip.driverEmployeeId,
    });

    return this.finishStop(tenantId, actorUserId, stopId, 'completed');
  }

  /**
   * Completing a delivery stop marks the underlying order 'delivered' via
   * Orders' public API, and files proof of delivery. recipientName is
   * always required; the delivery must also carry either a signature or
   * an already-uploaded 'pod' photo for this stop — proof of delivery
   * means something was actually captured, not just a button tapped.
   */
  async completeDeliveryStop(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
    dto: CompleteDeliveryDto,
  ): Promise<TripStopRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    if (trip.status !== 'in_progress') {
      throw new ConflictException('The trip must be in progress to complete a stop');
    }

    const stop = await this.getStopOnTrip(tenantId, tripId, stopId);
    if (stop.stopType !== 'delivery') throw new BadRequestException('This stop is not a delivery');
    if (stop.status !== 'pending') throw new ConflictException(`Stop is already ${stop.status}`);

    if (!dto.signatureData) {
      const podPhotoCount = await this.db.withTenant(tenantId, (client) =>
        this.photos.countByStopAndTypeWithClient(client, stopId, 'pod'),
      );
      if (podPhotoCount === 0) {
        throw new BadRequestException('Proof of delivery requires a signature or a POD photo');
      }
    }

    const order = await this.orders.getOrder(tenantId, stop.orderId as string);
    await this.orders.markDelivered(tenantId, actorUserId, order.id, order.version);

    await this.db.withTenant(tenantId, (client) =>
      this.pods.createWithClient(client, actorUserId, {
        tripStopId: stopId,
        recipientName: dto.recipientName,
        signatureData: dto.signatureData ?? null,
      }),
    );

    return this.finishStop(tenantId, actorUserId, stopId, 'completed');
  }

  async skipStop(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
  ): Promise<TripStopRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    if (trip.status !== 'in_progress') {
      throw new ConflictException('The trip must be in progress to skip a stop');
    }
    const stop = await this.getStopOnTrip(tenantId, tripId, stopId);
    if (stop.status !== 'pending') throw new ConflictException(`Stop is already ${stop.status}`);

    return this.finishStop(tenantId, actorUserId, stopId, 'skipped');
  }

  private async getStopOnTrip(tenantId: string, tripId: string, stopId: string): Promise<TripStopRecord> {
    const stop = await this.db.withTenant(tenantId, (client) => this.stops.findByIdWithClient(client, stopId));
    if (!stop || stop.tripId !== tripId) throw new NotFoundException('Stop not found on this trip');
    return stop;
  }

  private async finishStop(
    tenantId: string,
    actorUserId: string,
    stopId: string,
    status: 'completed' | 'skipped',
  ): Promise<TripStopRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.stops.findByIdWithClient(client, stopId);
      if (!before) throw new NotFoundException('Stop not found');

      const after =
        status === 'completed'
          ? await this.stops.completeWithClient(client, stopId)
          : await this.stops.skipWithClient(client, stopId);
      if (!after) throw new ConflictException(`Stop is already ${before.status}`);

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: STOP_ENTITY,
        entityId: stopId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Photos ----

  async listPhotos(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
  ): Promise<TripStopPhotoRecord[]> {
    await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    await this.getStopOnTrip(tenantId, tripId, stopId);
    return this.db.withTenant(tenantId, (client) => this.photos.listByStopWithClient(client, stopId));
  }

  /** Stores the uploaded bytes (S3 in production, local disk in development) and records them against the stop. */
  async addPhoto(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
    photoType: PhotoType,
    file: UploadedPhoto,
  ): Promise<TripStopPhotoRecord> {
    await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    await this.getStopOnTrip(tenantId, tripId, stopId);

    if (!VALID_PHOTO_CONTENT_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported image type: ${file.mimetype}`);
    }

    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const relativeKey = `${tenantId}/${stopId}/${randomUUID()}.${extension}`;
    await this.storage.put(relativeKey, file.buffer, file.mimetype);

    return this.db.withTenant(tenantId, (client) =>
      this.photos.createWithClient(client, actorUserId, {
        tripStopId: stopId,
        photoType,
        storageKey: relativeKey,
        contentType: file.mimetype,
        sizeBytes: file.size,
      }),
    );
  }

  // ---- Expenses ----

  async listExpenses(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
  ): Promise<TripExpenseRecord[]> {
    await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return this.db.withTenant(tenantId, (client) => this.expenses.listByTripWithClient(client, tripId));
  }

  async recordExpense(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    dto: RecordExpenseDto,
    key: string | null = null,
  ): Promise<TripExpenseRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    const find = () => this.db.withTenant(tenantId, (client) => this.expenses.findByClientRefWithClient(client, tripId, key as string));

    // A retry of an expense that already went through gets it back, even if
    // the trip has been reconciled since (Security Audit SA-03).
    return once({
      key,
      constraint: 'trip_expense_client_ref_unique',
      find,
      sameRequest: (prior) => sameExpense(prior, dto),
      write: async () => {
        if (trip.status === 'cancelled' || trip.status === 'reconciled') {
          throw new ConflictException(`Cannot record an expense against a ${trip.status} trip`);
        }
        return this.db.withTenant(tenantId, async (client) => {
          const expense = await this.expenses.createWithClient(client, actorUserId, {
            tripId,
            category: dto.category,
            amount: dto.amount,
            notes: dto.notes ?? null,
            clientRef: key,
          });
          await this.ledger.postTripExpenseWithClient(client, tenantId, actorUserId, {
            id: expense.id,
            tripId,
            category: expense.category,
            amount: expense.amount,
            notes: expense.notes,
            occurredAt: expense.recordedAt,
          });
          return expense;
        });
      },
    });
  }

  // ---- Collections ----

  async listCollections(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
  ): Promise<CustomerCollectionRecord[]> {
    await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    await this.getStopOnTrip(tenantId, tripId, stopId);
    return this.db.withTenant(tenantId, (client) => this.collections.listByStopWithClient(client, stopId));
  }

  /**
   * Cash/payment collected from the customer at a delivery stop. Logistics
   * keeps the capture (who collected what, at which stop); Finance records
   * it as a customer payment, applied to that order's invoice, with its
   * ledger entry, in the same transaction.
   */
  async recordCollection(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
    dto: RecordCollectionDto,
    key: string | null = null,
  ): Promise<CustomerCollectionRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    const stop = await this.getStopOnTrip(tenantId, tripId, stopId);
    if (stop.stopType !== 'delivery') {
      throw new BadRequestException('Collections can only be recorded against a delivery stop');
    }

    const order = await this.orders.getOrder(tenantId, stop.orderId as string);
    const find = () => this.db.withTenant(tenantId, (client) => this.collections.findByClientRefWithClient(client, stopId, key as string));

    // A retried collection gets the one already recorded back, never a second payment (Security Audit SA-03).
    return once({
      key,
      constraint: 'customer_collection_client_ref_unique',
      find,
      sameRequest: (prior) => sameCollection(prior, dto),
      write: () => {
        // New cash on a reconciled trip would silently unbalance a settled
        // reconciliation (a retry of one already recorded still comes back above).
        if (trip.status === 'cancelled' || trip.status === 'reconciled') {
          throw new ConflictException(`Cannot record a collection against a ${trip.status} trip`);
        }
        return this.db.withTenant(tenantId, async (client) => {
          const collection = await this.collections.createWithClient(client, tenantId, actorUserId, {
            tripStopId: stopId,
            orderId: order.id,
            amount: dto.amount,
            method: dto.method,
            notes: dto.notes ?? null,
            clientRef: key,
          });
          await this.receivables.recordCollectionPaymentWithClient(client, tenantId, actorUserId, {
            collectionId: collection.id,
            customerId: order.customerId,
            orderId: order.id,
            amount: collection.amount,
            method: collection.method,
            notes: collection.notes,
            collectedAt: collection.collectedAt,
          });
          return collection;
        });
      },
    });
  }

  // ---- Reconciliation ----

  getReconciliation(tenantId: string, tripId: string): Promise<TripReconciliationRecord | null> {
    return this.db.withTenant(tenantId, (client) => this.reconciliations.findByTripWithClient(client, tripId));
  }

  /**
   * variance = advance - (expenses + cashReturned). Zero means the driver
   * fully accounted for the float; positive means cash is missing. Posted
   * to the ledger in the same transaction (LedgerService: the float clears
   * to cash on hand, any gap to cash shortage or cash over). Deliberately not
   * ownership-scoped: reconciliation is a supervisory action, gated by its
   * own logistics:reconcile permission, over any driver's trip.
   */
  async reconcileTrip(
    tenantId: string,
    actorUserId: string,
    tripId: string,
    dto: ReconcileTripDto,
  ): Promise<TripReconciliationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const trip = await this.trips.findByIdWithClient(client, tripId);
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status !== 'completed') {
        throw new ConflictException(`Cannot reconcile a trip in status '${trip.status}'`);
      }

      // Cash the driver took for spot sales is part of what they owe back.
      const spot = await this.reconciliations.spotSalesWithClient(client, tripId);
      if (spot.pending > 0) {
        throw new ConflictException(`${spot.pending} spot sale(s) on this trip still await an approval decision — decide them first`);
      }
      const totalExpenses = await this.expenses.sumByTripWithClient(client, tripId);
      const advanceAmount = Number(trip.advanceAmount);
      const variance = Math.round((advanceAmount + Number(spot.cash) - (totalExpenses + dto.cashReturned)) * 100) / 100;

      const reconciliation = await this.reconciliations.createWithClient(client, actorUserId, {
        tripId,
        advanceAmount,
        totalExpenses,
        cashReturned: dto.cashReturned,
        spotCash: spot.cash,
        variance,
        notes: dto.notes ?? null,
      });
      await this.ledger.postTripReconciliationWithClient(client, tenantId, actorUserId, {
        id: reconciliation.id,
        tripId,
        advanceAmount: reconciliation.advanceAmount,
        cashIn: reconciliation.spotCash,
        totalExpenses: reconciliation.totalExpenses,
        cashReturned: reconciliation.cashReturned,
        occurredAt: reconciliation.reconciledAt,
      });

      const after = await this.trips.markReconciledWithClient(client, tripId, dto.version);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: tripId,
        before: trip as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });

      return reconciliation;
    });
  }
}

// Same action retried, or a different one under a reused key? Amounts compared in paise.
function sameExpense(prior: TripExpenseRecord, dto: RecordExpenseDto): boolean {
  return prior.category === dto.category && toCents(prior.amount) === toCents(String(dto.amount));
}

function sameCollection(prior: CustomerCollectionRecord, dto: RecordCollectionDto): boolean {
  return prior.method === dto.method && toCents(prior.amount) === toCents(String(dto.amount));
}
