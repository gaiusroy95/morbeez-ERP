import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { AlertsRepository } from '../alerts/alerts.repository';
import { compareMoney, moneyFromNumber, normalizeMoney, subtractMoney, toCents } from '../../common/money';
import { LogisticsService, UploadedPhoto } from './logistics.service';
import { DelegationService } from './delegation.service';
import { BackhaulsRepository } from './repositories/backhauls.repository';
import { TripStopsRepository } from './repositories/trip-stops.repository';
import { BackhaulPhotoRecord, BackhaulPhotoType, BackhaulRecord } from './entities/backhaul.entity';
import { TripRecord } from './entities/trip.entity';
import { happenedAt, routeOf, stepAt, stepProblemOf } from './backhaul';
import { BackhaulPaymentDto, BackhaulStepDto, CancelBackhaulDto, CreateBackhaulDto, SkipBackhaulDto } from './dto/backhaul.dto';

const ENTITY = 'backhaul';
const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * Backhaul (driver app D5; client spec §16–§17, the client's answer 6): a
 * fixed-rent transport job on the way back — no product, no kilos, no stock.
 * The owner offers one, or the driver adds one taken on the road; the
 * driver accepts or skips it, runs it step by step (the load and the drop
 * photographed) and records what was paid. The rent is income when it's
 * received:
 *   Dr Cash with drivers (cash) or Bank (UPI, transfer) / Cr Backhaul income
 * and rent paid in cash is part of the driver's handover. Every request can
 * be sent again (offline replay) and changes nothing the second time.
 */
@Injectable()
export class BackhaulService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: ObjectStorageService,
    private readonly logistics: LogisticsService,
    private readonly delegation: DelegationService,
    private readonly backhauls: BackhaulsRepository,
    private readonly stops: TripStopsRepository,
    private readonly ledger: LedgerService,
    private readonly alerts: AlertsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string): Promise<BackhaulRecord[]> {
    await this.logistics.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    return this.db.withTenant(tenantId, (client) => this.backhauls.listByTripWithClient(client, tripId));
  }

  /** The owner offers a backhaul; a driver adds one they took on the road, accepted as it's added. */
  async create(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string, dto: CreateBackhaulDto): Promise<BackhaulRecord> {
    const trip = await this.logistics.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    if (!(trip.status === 'in_progress' || (callerIsDispatcher && trip.status === 'planned'))) {
      throw new ConflictException(callerIsDispatcher ? 'A backhaul is offered on a trip that is planned or on the road' : 'A backhaul is added on the road');
    }
    if (trip.closingKm !== null) throw new ConflictException('The vehicle is already back (Return recorded)');
    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deliver');
    const offeredBy = callerIsDispatcher ? 'owner' : 'driver';
    return this.db.withTenant(tenantId, async (client) => {
      const { id, created } = await this.backhauls.createWithClient(client, tenantId, actorUserId, {
        id: dto.id ?? null,
        tripId,
        pickupPlace: dto.pickupPlace.trim(),
        dropPlace: dto.dropPlace.trim(),
        rent: moneyFromNumber(dto.rent),
        hirerName: clean(dto.hirerName),
        notes: clean(dto.notes),
        offeredBy,
      });
      const backhaul = await this.backhauls.findWithClient(client, id);
      if (!backhaul || backhaul.tripId !== tripId) throw new ConflictException('That backhaul belongs to another trip');
      if (!created) return backhaul;
      if (offeredBy === 'driver') {
        await this.alerts.raiseWithClient(client, tenantId, {
          kind: 'operational_problem',
          severity: 'warning',
          title: `The driver took a backhaul: ${routeOf(backhaul)}`,
          detail: `Rent ₹${normalizeMoney(backhaul.rent)}${backhaul.hirerName ? `, for ${backhaul.hirerName}` : ''}. It's on the trip's Backhaul tab; the rent is booked as income when it's paid.`,
          tripId,
          dedupeKey: `backhaul:${backhaul.id}:added`,
        });
      }
      await this.audit.record(client, { tenantId, actorUserId, action: 'create', entityType: ENTITY, entityId: backhaul.id, after: backhaul as unknown as Record<string, unknown> });
      return backhaul;
    });
  }

  async accept(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string, backhaulId: string): Promise<BackhaulRecord> {
    const { trip, backhaul } = await this.onTrip(tenantId, actorUserId, callerIsDispatcher, tripId, backhaulId);
    if (backhaul.status === 'accepted' || backhaul.status === 'completed') return backhaul;
    if (backhaul.status !== 'offered') throw new ConflictException(`This backhaul was ${backhaul.status}`);
    this.assertOnTheRoad(trip);
    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deliver');
    return this.change(tenantId, actorUserId, backhaul, (client) => this.backhauls.acceptWithClient(client, backhaul.id, new Date()));
  }

  /** The driver turns an offer down, saying why; the owner hears. */
  async skip(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string, backhaulId: string, dto: SkipBackhaulDto): Promise<BackhaulRecord> {
    const { trip, backhaul } = await this.onTrip(tenantId, actorUserId, callerIsDispatcher, tripId, backhaulId);
    if (backhaul.status === 'skipped') return backhaul;
    if (backhaul.status !== 'offered') throw new ConflictException(`Only an offer is skipped — this backhaul is ${backhaul.status}`);
    const reason = dto.reason.trim();
    return this.change(tenantId, actorUserId, backhaul, async (client) => {
      const skipped = await this.backhauls.skipWithClient(client, backhaul.id, reason);
      if (skipped && !callerIsDispatcher) {
        await this.alerts.raiseWithClient(client, tenantId, {
          kind: 'operational_problem',
          severity: 'warning',
          title: `Backhaul skipped: ${routeOf(backhaul)}`,
          detail: `The driver of ${trip.number} skipped your offer of ₹${normalizeMoney(backhaul.rent)}: ${reason}.`,
          tripId,
          dedupeKey: `backhaul:${backhaul.id}:skipped`,
        });
      }
      return skipped;
    });
  }

  /** The owner calls a backhaul off before it's done. */
  async cancel(tenantId: string, actorUserId: string, tripId: string, backhaulId: string, dto: CancelBackhaulDto): Promise<BackhaulRecord> {
    const { backhaul } = await this.onTrip(tenantId, actorUserId, true, tripId, backhaulId);
    if (backhaul.status === 'cancelled') return backhaul;
    if (backhaul.status === 'completed' || backhaul.status === 'skipped') {
      throw new ConflictException(`A ${backhaul.status} backhaul can't be cancelled`);
    }
    return this.change(tenantId, actorUserId, backhaul, (client) => this.backhauls.cancelWithClient(client, backhaul.id, clean(dto.reason)));
  }

  /**
   * Pickup reached → loaded → drop reached → completed, in that order; the
   * load and the drop are photographed first. It starts once the last
   * delivery is done: a backhaul runs on the way back.
   */
  async step(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string, backhaulId: string, dto: BackhaulStepDto): Promise<BackhaulRecord> {
    const { trip, backhaul } = await this.onTrip(tenantId, actorUserId, callerIsDispatcher, tripId, backhaulId);
    if (stepAt(backhaul, dto.step) !== null) return backhaul;
    const problem = stepProblemOf(backhaul, dto.step);
    if (problem) throw new ConflictException(problem);
    this.assertOnTheRoad(trip);
    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'deliver');
    if (dto.step === 'pickup_reached') {
      const pending = await this.db.withTenant(tenantId, (client) => this.stops.countPendingWithClient(client, tripId));
      if (pending > 0) throw new ConflictException(`Finish the ${pending} stop(s) still to do first — a backhaul runs on the way back`);
    }
    return this.change(tenantId, actorUserId, backhaul, (client) => this.backhauls.stepWithClient(client, backhaul.id, dto.step, happenedAt(backhaul, dto.at)));
  }

  /**
   * What the hirer paid — by cash (it's with the driver until the
   * handover), UPI or a transfer — booked as income at once. Never more than
   * the rent; less is recorded as it is and the owner hears. The owner can
   * record it too (paid to them directly), until the trip is closed.
   */
  async pay(tenantId: string, actorUserId: string, callerIsDispatcher: boolean, tripId: string, backhaulId: string, dto: BackhaulPaymentDto): Promise<BackhaulRecord> {
    const { trip, backhaul } = await this.onTrip(tenantId, actorUserId, callerIsDispatcher, tripId, backhaulId);
    const amount = moneyFromNumber(dto.amount);
    if (backhaul.payment) {
      if (backhaul.payment.method === dto.method && toCents(backhaul.payment.amount) === toCents(amount)) return backhaul;
      throw new ConflictException(`This backhaul's payment is already recorded: ₹${normalizeMoney(backhaul.payment.amount)} by ${backhaul.payment.method.replace('_', ' ')}`);
    }
    if (backhaul.status !== 'completed') throw new ConflictException('Complete the backhaul first');
    if (!['in_progress', 'completed', 'on_hold'].includes(trip.status)) throw new ConflictException(`The trip is ${trip.status}`);
    if (compareMoney(amount, backhaul.rent) > 0) {
      throw new BadRequestException(`The rent is ₹${normalizeMoney(backhaul.rent)} — record no more than that`);
    }
    await this.delegation.assertCan(tenantId, callerIsDispatcher, trip, 'collect');
    const at = happenedAt(backhaul, dto.at);
    return this.change(tenantId, actorUserId, backhaul, async (client) => {
      const paid = await this.backhauls.payWithClient(client, backhaul.id, actorUserId, {
        method: dto.method,
        amount,
        reference: clean(dto.reference),
        note: clean(dto.note),
        at,
      });
      if (!paid) return false;
      await this.ledger.postBackhaulIncomeWithClient(client, tenantId, actorUserId, {
        id: backhaul.id,
        tripNumber: trip.number,
        route: routeOf(backhaul),
        method: dto.method,
        amount,
        occurredAt: at,
      });
      const short = subtractMoney(backhaul.rent, amount);
      if (compareMoney(short, '0') > 0) {
        await this.alerts.raiseWithClient(client, tenantId, {
          kind: 'collection_discrepancy',
          severity: 'warning',
          title: `Backhaul rent ₹${short} short: ${routeOf(backhaul)}`,
          detail: `₹${amount} received of the ₹${normalizeMoney(backhaul.rent)} rent on ${trip.number}${clean(dto.note) ? ` (${clean(dto.note)})` : ''}.`,
          tripId,
          dedupeKey: `backhaul:${backhaul.id}:short`,
        });
      }
      return true;
    });
  }

  /** The load, the drop, the payment proof — kept with the backhaul. */
  async addPhoto(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    backhaulId: string,
    photoType: BackhaulPhotoType,
    file: UploadedPhoto,
  ): Promise<BackhaulPhotoRecord> {
    const { backhaul } = await this.onTrip(tenantId, actorUserId, callerIsDispatcher, tripId, backhaulId);
    if (backhaul.status !== 'accepted' && backhaul.status !== 'completed') {
      throw new ConflictException(`This backhaul is ${backhaul.status}`);
    }
    if (!PHOTO_CONTENT_TYPES.includes(file.mimetype)) throw new BadRequestException(`Unsupported image type: ${file.mimetype}`);
    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `${tenantId}/backhaul/${backhaulId}/${randomUUID()}.${extension}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.db.withTenant(tenantId, (client) =>
      this.backhauls.insertPhotoWithClient(client, tenantId, actorUserId, {
        backhaulId,
        photoType,
        storageKey: key,
        contentType: file.mimetype,
        sizeBytes: file.size,
      }),
    );
  }

  private async onTrip(
    tenantId: string,
    actorUserId: string,
    callerIsDispatcher: boolean,
    tripId: string,
    backhaulId: string,
  ): Promise<{ trip: TripRecord; backhaul: BackhaulRecord }> {
    const trip = await this.logistics.getTrip(tenantId, actorUserId, callerIsDispatcher, tripId);
    const backhaul = await this.db.withTenant(tenantId, (client) => this.backhauls.findWithClient(client, backhaulId));
    if (!backhaul || backhaul.tripId !== tripId) throw new NotFoundException('Backhaul not found on this trip');
    return { trip, backhaul };
  }

  private assertOnTheRoad(trip: TripRecord): void {
    if (trip.status !== 'in_progress') throw new ConflictException(`The trip is ${trip.status}`);
    if (trip.closingKm !== null) throw new ConflictException('The vehicle is already back (Return recorded)');
  }

  /** Applies [work] and returns the backhaul as it now stands; a change that no longer applied (a race) is a conflict. */
  private change(tenantId: string, actorUserId: string, before: BackhaulRecord, work: (client: PoolClient) => Promise<boolean>): Promise<BackhaulRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      if (!(await work(client))) throw new ConflictException('This backhaul changed meanwhile — reload it');
      const after = (await this.backhauls.findWithClient(client, before.id)) as BackhaulRecord;
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY,
        entityId: before.id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}
