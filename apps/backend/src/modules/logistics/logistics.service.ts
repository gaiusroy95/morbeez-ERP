import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
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
import { TripCashDepositsRepository } from './repositories/trip-cash-deposits.repository';
import { TripCashDepositRecord } from './entities/trip-cash-deposit.entity';
import { checklistOf, handoverOf, HandoverSummary } from './trip-closure';
import { ChecklistItem } from './entities/trip-reconciliation.entity';
import { TripReviewFacts } from './repositories/trip-reconciliations.repository';
import { TripRecord, TripStatus } from './entities/trip.entity';
import { TripStopRecord } from './entities/trip-stop.entity';
import { TripExpenseRecord } from './entities/trip-expense.entity';
import { TripReconciliationRecord } from './entities/trip-reconciliation.entity';
import { PhotoType, TripStopPhotoRecord } from './entities/trip-stop-photo.entity';
import { CustomerCollectionRecord } from './entities/customer-collection.entity';
import { clampPageSize, PaginatedResult } from '../../common/persistence/pagination';
import { once } from '../../common/idempotency';
import { moneyFromNumber, subtractMoney, sumMoney, toCents } from '../../common/money';
import { CreateTripDto } from './dto/create-trip.dto';
import { AddPickupStopDto } from './dto/add-pickup-stop.dto';
import { AddDeliveryStopDto } from './dto/add-delivery-stop.dto';
import { VersionDto } from './dto/version.dto';
import { RecordExpenseDto } from './dto/record-expense.dto';
import { ReconcileTripDto } from './dto/reconcile-trip.dto';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto';
import { RecordCollectionDto } from './dto/record-collection.dto';
import { SubmitTripDto } from './dto/submit-trip.dto';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { TripDecisionDto } from './dto/trip-decision.dto';
import { ReportProblemDto } from './dto/report-problem.dto';
import { DelegationService } from './delegation.service';
import { Authority } from './delegation';
import { AlertsRepository } from '../alerts/alerts.repository';
import { DeliveryLineFacts, DeliveryMeasuresRepository } from './repositories/delivery-measures.repository';
import { LineMeasure, measureLine } from './measures';
import { FarmWeightDto } from './dto/complete-pickup-stop.dto';

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
    private readonly deposits: TripCashDepositsRepository,
    private readonly vehicles: VehiclesService,
    private readonly workforce: WorkforceService,
    private readonly procurement: ProcurementService,
    private readonly orders: OrdersService,
    private readonly receivables: ReceivablesService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly payroll: PayrollService,
    private readonly fleet: FleetService,
    private readonly delegation: DelegationService,
    private readonly alerts: AlertsRepository,
    private readonly measures: DeliveryMeasuresRepository,
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
    // Setting off needs authority for this trip — standing, or the owner's approval.
    await this.delegation.assertCan(tenantId, callerIsDispatcher, before, 'deliver');

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
    dto: SubmitTripDto,
  ): Promise<TripRecord> {
    const before = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, id);

    return this.db.withTenant(tenantId, async (client) => {
      const pending = await this.stops.countPendingWithClient(client, id);
      if (pending > 0) {
        throw new ConflictException(`${pending} stop(s) on this trip are still pending`);
      }

      // The driver submits; only the owner closes (reconcileTrip).
      const after = await this.trips.completeWithClient(client, id, dto.version, {
        submittedBy: actorUserId,
        cashDeclared: dto.cashDeclared ?? null,
        note: dto.note?.trim() || null,
      });
      // The driver's day of work, for their pay (Workforce), with the trip.
      await this.payroll.recordTripWorkWithClient(client, tenantId, actorUserId, id);
      await this.submissionAlertsWithClient(client, tenantId, after);
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
      return stops.map((s) => ({
        ...s,
        party: details.get(s.id)?.party ?? null,
        items: details.get(s.id)?.items ?? [],
        collect: details.get(s.id)?.collect ?? null,
      }));
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
    weights: FarmWeightDto[] = [],
  ): Promise<TripStopRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    if (trip.status !== 'in_progress') {
      throw new ConflictException('The trip must be in progress to complete a stop');
    }

    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'procure');
    const stop = await this.getStopOnTrip(tenantId, tripId, stopId);
    if (stop.stopType !== 'pickup') throw new BadRequestException('This stop is not a pickup');
    if (stop.status !== 'pending') throw new ConflictException(`Stop is already ${stop.status}`);

    const pickup = await this.procurement.getPickup(tenantId, stop.pickupId as string);
    await this.procurement.completePickup(tenantId, actorUserId, pickup.id, {
      version: pickup.version,
      vehicleId: trip.vehicleId,
      driverEmployeeId: trip.driverEmployeeId,
    });
    // The farm weighment (client Q&A, live chicken): the net weight entered
    // at the farm receives the goods — it's the purchase weight, what the
    // farmer is settled on. Entered as weighed; no tare arithmetic here.
    if (weights.length > 0) {
      await this.procurement.receiveGoods(tenantId, actorUserId, pickup.purchaseOrderId, {
        pickupId: pickup.id,
        lines: weights.map((w) => ({ productId: w.productId, receivedQuantity: w.netQuantity })),
      });
    }

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

    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deliver');
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
    const measured = await this.measureDelivery(tenantId, stopId, order.id, dto);
    await this.orders.markDelivered(
      tenantId,
      actorUserId,
      order.id,
      order.version,
      new Map(measured.map((m) => [m.line.orderLineId, m.measure.settled])),
    );

    await this.db.withTenant(tenantId, async (client) => {
      await this.pods.createWithClient(client, actorUserId, {
        tripStopId: stopId,
        recipientName: dto.recipientName,
        signatureData: dto.signatureData ?? null,
      });
      for (const { line, measure } of measured) {
        await this.measures.insertWithClient(client, tenantId, actorUserId, {
          tripStopId: stopId,
          orderLineId: line.orderLineId,
          productId: line.productId,
          measure,
        });
        if (!measure.withinTolerance) {
          const shrink = measure.kind === 'weighment';
          await this.alerts.raiseWithClient(client, tenantId, {
            kind: shrink ? 'shrinkage' : 'breakage',
            severity: 'critical',
            title: `${shrink ? 'Shrinkage' : 'Breakage'} ${measure.lossPct}% on ${line.productName} — above ${measure.tolerancePct}%`,
            detail: shrink
              ? `Farm weight ${measure.dispatched} kg, customer's scale ${measure.settled} kg: ${measure.loss} kg lost in transit. The customer is invoiced on their weight.`
              : `${Number(measure.loss)} of ${Number(measure.dispatched)} eggs broke on the way; the customer is invoiced for ${Number(measure.settled)}.`,
            tripId,
            dedupeKey: `loss:${line.orderLineId}`,
          });
        }
      }
    });

    return this.finishStop(tenantId, actorUserId, stopId, 'completed');
  }

  /**
   * The customer-end measures a delivery carries (client Q&A, live chicken
   * and eggs): a customer weight for live birds, eggs broken for eggs; each
   * becomes what that line is invoiced at. Checked before anything is
   * written, so a bad entry changes nothing. When the owner requires a photo
   * of the customer's scale, a 'weighment' photo must already be on the stop.
   */
  private async measureDelivery(
    tenantId: string,
    stopId: string,
    orderId: string,
    dto: CompleteDeliveryDto,
  ): Promise<{ line: DeliveryLineFacts; measure: LineMeasure }[]> {
    const entries = dto.lines ?? [];
    if (entries.length === 0) return [];
    return this.db.withTenant(tenantId, async (client) => {
      const facts = new Map((await this.measures.lineFactsWithClient(client, orderId)).map((l) => [l.orderLineId, l]));
      const out: { line: DeliveryLineFacts; measure: LineMeasure }[] = [];
      for (const entry of entries) {
        const line = facts.get(entry.orderLineId);
        if (!line) throw new BadRequestException('That line is not on this delivery');
        if (entry.customerWeight !== undefined) {
          if (line.kind !== 'live_bird') throw new BadRequestException(`${line.productName} isn't sold by live weight`);
          if (line.weighmentPhoto === 'required' && (await this.photos.countByStopAndTypeWithClient(client, stopId, 'weighment')) === 0) {
            throw new BadRequestException("Photograph the customer's scale first — the owner requires it with a customer weight");
          }
          out.push({ line, measure: this.measure('weighment', line, entry.customerWeight) });
        } else if (entry.brokenQuantity !== undefined) {
          if (line.kind !== 'egg') throw new BadRequestException(`${line.productName} isn't eggs`);
          out.push({ line, measure: this.measure('breakage', line, entry.brokenQuantity) });
        }
      }
      return out;
    });
  }

  private measure(kind: 'weighment' | 'breakage', line: DeliveryLineFacts, entered: number): LineMeasure {
    try {
      return measureLine({ kind, dispatched: line.quantity, entered, tolerancePct: line.tolerancePct ?? '0' });
    } catch (err) {
      throw new BadRequestException(`${line.productName}: ${(err as Error).message}`);
    }
  }

  async skipStop(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    stopId: string,
    reason: string | null = null,
  ): Promise<TripStopRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    if (trip.status !== 'in_progress') {
      throw new ConflictException('The trip must be in progress to skip a stop');
    }
    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deliver');
    const stop = await this.getStopOnTrip(tenantId, tripId, stopId);
    if (stop.status !== 'pending') throw new ConflictException(`Stop is already ${stop.status}`);

    const after = await this.finishStop(tenantId, actorUserId, stopId, 'skipped', reason?.trim() || null);
    // A delivery the customer didn't take, or a pickup that didn't happen,
    // reaches the owner at once (client Q&A, E: Q19).
    await this.db.withTenant(tenantId, async (client) => {
      const details = await this.stops.detailsForTripWithClient(client, tripId);
      const party = details.get(stopId)?.party?.name ?? (stop.stopType === 'delivery' ? 'A customer' : 'A farmer');
      const why = after.notes ? ` — ${after.notes}` : '';
      await this.alerts.raiseWithClient(client, tenantId, {
        kind: stop.stopType === 'delivery' ? 'customer_rejection' : 'procurement_issue',
        severity: 'critical',
        title: stop.stopType === 'delivery' ? `Not delivered: ${party}` : `Pickup missed: ${party}`,
        detail: `${stop.stopType === 'delivery' ? 'The delivery' : 'The pickup'} on this trip wasn't done${why}.`,
        tripId,
        dedupeKey: `skip:${stopId}`,
      });
    });
    return after;
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
    reason: string | null = null,
  ): Promise<TripStopRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.stops.findByIdWithClient(client, stopId);
      if (!before) throw new NotFoundException('Stop not found');

      const after =
        status === 'completed'
          ? await this.stops.completeWithClient(client, stopId)
          : await this.stops.skipWithClient(client, stopId, reason);
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
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deliver');
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
        // Spending is a full route operator's call (level 4). Below that the
        // driver still records what they paid — the money is gone either
        // way — and the owner approves it at closure.
        const authority = callerIsDispatcher ? null : await this.delegation.authorityOnTrip(tenantId, trip);
        return this.db.withTenant(tenantId, async (client) => {
          const expense = await this.expenses.createWithClient(client, actorUserId, {
            tripId,
            category: dto.category,
            amount: dto.amount,
            notes: dto.notes ?? null,
            clientRef: key,
            needsApproval: authority !== null && !authority.can.expense,
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
      write: async () => {
        // New cash on a reconciled trip would silently unbalance a settled
        // reconciliation (a retry of one already recorded still comes back above).
        if (trip.status === 'cancelled' || trip.status === 'reconciled') {
          throw new ConflictException(`Cannot record a collection against a ${trip.status} trip`);
        }
        await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'collect');
        return this.db.withTenant(tenantId, async (client) => {
          const collection = await this.collections.createWithClient(client, tenantId, actorUserId, {
            tripStopId: stopId,
            orderId: order.id,
            amount: dto.amount,
            method: dto.method,
            notes: dto.notes ?? null,
            clientRef: key,
            // Cash stays with the driver until they hand it over; UPI, bank
            // and cheque payments reach the business directly.
            intoDriverFloat: dto.method === 'cash',
          });
          await this.receivables.recordCollectionPaymentWithClient(client, tenantId, actorUserId, {
            collectionId: collection.id,
            customerId: order.customerId,
            orderId: order.id,
            amount: collection.amount,
            method: collection.method,
            notes: collection.notes,
            collectedAt: collection.collectedAt,
            receivedInto: collection.intoDriverFloat ? 'cash_with_drivers' : undefined,
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
  // ---- Handover: deposits on the road ----

  async listDeposits(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string): Promise<TripCashDepositRecord[]> {
    await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return this.db.withTenant(tenantId, (client) => this.deposits.listByTripWithClient(client, tripId));
  }

  /**
   * Cash the driver paid into the bank on the road (money handover, case
   * C): it leaves what they hold, for the bank. Recorded while the trip is
   * theirs to change — before they submit it, or after the owner returns it.
   */
  async recordDeposit(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    dto: RecordDepositDto,
    key: string | null = null,
  ): Promise<TripCashDepositRecord> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return once({
      key,
      constraint: 'trip_cash_deposit_client_ref_unique',
      find: () => this.db.withTenant(tenantId, (client) => this.deposits.findByClientRefWithClient(client, tripId, key as string)),
      sameRequest: (prior) => toCents(prior.amount) === toCents(moneyFromNumber(dto.amount)) && prior.reference === dto.reference,
      write: async () => {
        const open = trip.status === 'in_progress' || (callerIsDispatcher && (trip.status === 'completed' || trip.status === 'on_hold'));
        if (!open) throw new ConflictException(`Cannot record a bank deposit on a ${trip.status} trip`);
        await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deposit');
        return this.db.withTenant(tenantId, async (client) => {
          const deposit = await this.deposits.createWithClient(client, tenantId, actorUserId, {
            tripId,
            amount: dto.amount,
            bankAccount: dto.bankAccount.trim(),
            reference: dto.reference.trim(),
            depositedAt: dto.depositedAt ? new Date(dto.depositedAt) : new Date(),
            clientRef: key,
          });
          await this.ledger.postTripCashDepositWithClient(client, tenantId, actorUserId, {
            id: deposit.id,
            tripId,
            amount: deposit.amount,
            bankAccount: deposit.bankAccount,
            reference: deposit.reference,
            occurredAt: deposit.depositedAt,
          });
          return deposit;
        });
      },
    });
  }

  // ---- Authority and problems on the road ----

  /** What the trip's driver may do on it right now — the Driver app shows and greys out actions by it. */
  async getAuthority(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string): Promise<Authority> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return this.delegation.authorityOnTrip(tenantId, trip);
  }

  /**
   * The driver can't go on, the trip can't proceed, something's wrong or
   * unsafe: the owner hears at once (client Q&A, E: Q19).
   */
  async reportProblem(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    dto: ReportProblemDto,
    key: string | null = null,
  ): Promise<{ reported: true }> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    const titles: Record<ReportProblemDto['kind'], string> = {
      driver_unable_to_continue: "The driver can't continue",
      trip_blocked: "The trip can't proceed",
      operational_problem: 'A problem on the road',
      security: 'Security problem on the road',
    };
    return this.db.withTenant(tenantId, async (client) => {
      const driver = await client.query<{ name: string }>('SELECT name FROM trading_partners.employee WHERE id = $1', [trip.driverEmployeeId]);
      await this.alerts.raiseWithClient(client, tenantId, {
        kind: dto.kind,
        severity: 'critical',
        title: `${titles[dto.kind]} — ${driver.rows[0]?.name ?? 'driver'}`,
        detail: dto.note.trim(),
        tripId,
        // A retried report (same Idempotency-Key) is one alert.
        dedupeKey: `problem:${tripId}:${key ?? randomUUID()}`,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: tripId,
        after: { problemReported: dto.kind, note: dto.note.trim() },
      });
      return { reported: true as const };
    });
  }

  /**
   * On submission, what's out of the ordinary reaches the owner at once:
   * the cash handed over is off by more than the business's threshold, or
   * cash customers paid well short (client Q&A, E: Q19). The rest waits
   * for the evening summary.
   */
  private async submissionAlertsWithClient(client: PoolClient, tenantId: string, trip: TripRecord): Promise<void> {
    const thresholds = (
      await client.query<{ cash: string; collection: string }>(
        'SELECT alert_cash_threshold::text AS cash, alert_collection_threshold::text AS collection FROM tenant.tenant WHERE id = $1',
        [tenantId],
      )
    ).rows[0] ?? { cash: '500.00', collection: '1000.00' };
    const driver =
      (await client.query<{ name: string }>('SELECT name FROM trading_partners.employee WHERE id = $1', [trip.driverEmployeeId])).rows[0]?.name ??
      'The driver';

    const handover = await this.handoverWithClient(client, trip);
    if (handover.declared !== null) {
      const diff = subtractMoney(handover.declared, handover.expected);
      const size = diff.replace('-', '');
      if (Number(size) > 0 && Number(size) >= Number(thresholds.cash)) {
        await this.alerts.raiseWithClient(client, tenantId, {
          kind: 'cash_mismatch',
          severity: 'critical',
          title: `Cash ${diff.startsWith('-') ? 'short' : 'over'} by ₹${size} — ${driver}`,
          detail: `${driver} is handing over ₹${handover.declared} against ₹${handover.expected} expected.${trip.submitNote ? ` Their note: ${trip.submitNote}` : ''}`,
          tripId: trip.id,
          dedupeKey: `cash:${trip.id}:${trip.version}`,
        });
      }
    }

    const facts = await this.reconciliations.reviewFactsWithClient(client, trip.id);
    const short = facts.unpaidCashCustomers.map((u) => ({ ...u, gap: subtractMoney(u.invoiced, u.collected) }));
    const totalShort = sumMoney(short.map((s) => s.gap));
    if (short.length > 0 && Number(totalShort) >= Number(thresholds.collection)) {
      await this.alerts.raiseWithClient(client, tenantId, {
        kind: 'collection_discrepancy',
        severity: 'critical',
        title: `₹${totalShort} not collected from cash customers — ${driver}`,
        detail: short.map((s) => `${s.customer}: paid ₹${s.collected} of ₹${s.invoiced}`).join('; ') + '.',
        tripId: trip.id,
        dedupeKey: `collections:${trip.id}:${trip.version}`,
      });
    }
  }

  // ---- Handover & closure ----

  /** What the driver should hand over — for the driver's own trip, or any trip for the owner. */
  async getHandover(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string): Promise<HandoverSummary> {
    const trip = await this.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return this.db.withTenant(tenantId, (client) => this.handoverWithClient(client, trip));
  }

  private async handoverWithClient(client: PoolClient, trip: TripRecord): Promise<HandoverSummary> {
    const spot = await this.reconciliations.spotSalesWithClient(client, trip.id);
    const money = await this.reconciliations.moneyWithClient(client, trip.id);
    const expenses = await this.expenses.sumByTripWithClient(client, trip.id);
    return handoverOf({
      advance: trip.advanceAmount,
      cashCollections: money.cashCollections,
      spotCash: spot.cash,
      expenses: moneyFromNumber(expenses),
      deposited: money.deposited,
      declared: trip.cashDeclared,
      directPayments: money.directPayments,
    });
  }

  /**
   * Everything the owner checks before closing a submitted trip: the
   * handover, each area as pass or exception, and what the vehicle carried.
   * [cashReceived] is the cash counted so far, if any.
   */
  async reviewTrip(tenantId: string, tripId: string, cashReceived: number | null): Promise<TripReview> {
    return this.db.withTenant(tenantId, async (client) => {
      const trip = await this.trips.findByIdWithClient(client, tripId);
      if (!trip) throw new NotFoundException('Trip not found');
      const handover = await this.handoverWithClient(client, trip);
      const facts = await this.reconciliations.reviewFactsWithClient(client, tripId);
      const spot = await this.reconciliations.spotSalesWithClient(client, tripId);
      const checklist = checklistOf(facts, handover, cashReceived === null ? null : moneyFromNumber(cashReceived));
      return {
        trip,
        handover,
        checklist,
        load: facts.load,
        pendingSpotSales: spot.pending,
        exceptions: checklist.filter((c) => c.status === 'exception').length,
      };
    });
  }

  /** The owner puts a submitted trip on hold — to investigate before closing. */
  async holdTrip(tenantId: string, actorUserId: string, tripId: string, dto: TripDecisionDto): Promise<TripRecord> {
    return this.ownerDecision(tenantId, actorUserId, tripId, (client) => this.trips.holdWithClient(client, tripId, dto.version, dto.note.trim()));
  }

  /** The owner returns a submitted or held trip to the driver to correct; the driver submits again. */
  async returnToDriver(tenantId: string, actorUserId: string, tripId: string, dto: TripDecisionDto): Promise<TripRecord> {
    return this.ownerDecision(tenantId, actorUserId, tripId, (client) =>
      this.trips.returnToDriverWithClient(client, tripId, dto.version, dto.note.trim()),
    );
  }

  private async ownerDecision(
    tenantId: string,
    actorUserId: string,
    tripId: string,
    change: (client: PoolClient) => Promise<TripRecord>,
  ): Promise<TripRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.trips.findByIdWithClient(client, tripId);
      if (!before) throw new NotFoundException('Trip not found');
      if (before.status !== 'completed' && before.status !== 'on_hold') {
        throw new ConflictException(`A ${before.status} trip isn't waiting for the owner`);
      }
      const after = await change(client);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: TRIP_ENTITY,
        entityId: tripId,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  /**
   * The owner closes the trip: counts the cash handed over, settles the
   * trip's cash float in the ledger, and records what was checked. Nothing
   * closes silently: if any area is an exception, closing is an approval
   * that needs the owner's reason (approved exception).
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
      if (trip.status !== 'completed' && trip.status !== 'on_hold') {
        throw new ConflictException(`Cannot reconcile a trip in status '${trip.status}'`);
      }

      // Cash the driver took for spot sales is part of what they owe back.
      const spot = await this.reconciliations.spotSalesWithClient(client, tripId);
      if (spot.pending > 0) {
        throw new ConflictException(`${spot.pending} spot sale(s) on this trip still await an approval decision — decide them first`);
      }
      const handover = await this.handoverWithClient(client, trip);
      const facts: TripReviewFacts = await this.reconciliations.reviewFactsWithClient(client, tripId);
      const received = moneyFromNumber(dto.cashReturned);
      const checklist: ChecklistItem[] = checklistOf(facts, handover, received);
      const exceptions = checklist.filter((c) => c.status === 'exception');
      const exceptionNote = dto.exceptionNote?.trim() || null;
      if (exceptions.length > 0 && !exceptionNote) {
        throw new ConflictException(
          `This trip has ${exceptions.length} exception(s) — ${exceptions.map((e) => e.area).join(', ')}. ` +
            'Approving it anyway needs a reason (exceptionNote), or return it to the driver.',
        );
      }

      const variance = Number(subtractMoney(handover.expected, received));
      const reconciliation = await this.reconciliations.createWithClient(client, actorUserId, {
        tripId,
        advanceAmount: Number(trip.advanceAmount),
        totalExpenses: Number(handover.expenses),
        cashReturned: dto.cashReturned,
        spotCash: spot.cash,
        cashCollections: handover.cashCollections,
        cashDeposited: handover.deposited,
        directPayments: handover.directPayments,
        cashDeclared: trip.cashDeclared,
        variance,
        notes: dto.notes ?? null,
        outcome: exceptions.length > 0 ? 'approved_exception' : 'pass',
        exceptionNote: exceptions.length > 0 ? exceptionNote : null,
        checklist,
      });
      await this.ledger.postTripReconciliationWithClient(client, tenantId, actorUserId, {
        id: reconciliation.id,
        tripId,
        advanceAmount: reconciliation.advanceAmount,
        cashIn: sumMoney([reconciliation.spotCash, reconciliation.cashCollections]),
        totalExpenses: reconciliation.totalExpenses,
        cashDeposited: reconciliation.cashDeposited,
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

export interface TripReview {
  trip: TripRecord;
  handover: HandoverSummary;
  checklist: ChecklistItem[];
  load: TripReviewFacts['load'];
  pendingSpotSales: number;
  exceptions: number;
}

// Same action retried, or a different one under a reused key? Amounts compared in paise.
function sameExpense(prior: TripExpenseRecord, dto: RecordExpenseDto): boolean {
  return prior.category === dto.category && toCents(prior.amount) === toCents(String(dto.amount));
}

function sameCollection(prior: CustomerCollectionRecord, dto: RecordCollectionDto): boolean {
  return prior.method === dto.method && toCents(prior.amount) === toCents(String(dto.amount));
}
