import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { WorkforceService } from '../workforce/workforce.service';
import { EmployeeRecord } from '../workforce/entities/employee.entity';
import { TripsRepository } from './repositories/trips.repository';
import { DelegationsRepository, DriverPoolRow } from './repositories/delegations.repository';
import { TripRecord } from './entities/trip.entity';
import {
  Authority,
  authorityOf,
  Capability,
  CAPABILITY_LEVEL,
  DelegationRecord,
  LEVEL_NAMES,
  operatingDayEnd,
} from './delegation';
import { GrantDelegationDto, SetEligibilityDto, StartDayOffDto } from './dto/delegation.dto';

const DELEGATION_ENTITY = 'delegation';

type TripRef = Pick<TripRecord, 'id' | 'status' | 'driverEmployeeId'>;

/** Plain words for what each capability lets a driver do, for refusals. */
const CAPABILITY_WORDS: Record<Capability, string> = {
  deliver: 'deliver',
  collect: 'take payments',
  deposit: 'record bank deposits',
  spot_sale: 'make spot sales',
  procure: 'buy from farmers',
  expense: 'spend on the trip',
};

export interface DriverPoolEntry extends DriverPoolRow {
  /** Authority right now, outside any one trip (standing, day-off and temporary grants). */
  authority: Authority;
  /** The track record suggests they can run a route on their own (requirement: delegation score). */
  suggestedIndependent: boolean;
}

export interface DayOffState {
  away: boolean;
  until: Date | null;
  operatingDayEnd: string;
  grants: (DelegationRecord & { driverName: string; tripStatus: string | null })[];
}

/**
 * Owner independence: who may run a trip and with how much authority
 * (client Q&A 1 Oct 2026, D–E). Eligibility is the owner's standing
 * decision about a person; a grant authorizes them for a trip, a day off or
 * a while; authority is what those add up to right now — checked by the
 * server on every driver action, never by the app alone.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly delegations: DelegationsRepository,
    private readonly trips: TripsRepository,
    private readonly workforce: WorkforceService,
    private readonly audit: AuditService,
  ) {}

  // ---- Authority, for every driver action ----

  async authorityWithClient(
    client: PoolClient,
    employee: Pick<EmployeeRecord, 'id' | 'delegationLevel' | 'standingDelegation'>,
    trip: Pick<TripRecord, 'id' | 'status'> | null,
  ): Promise<Authority> {
    const grants = await this.delegations.listOpenForDriverWithClient(client, employee.id);
    return authorityOf(employee, grants, trip ? { id: trip.id, status: trip.status } : null);
  }

  /** The trip's own driver's authority on it. */
  async authorityOnTrip(tenantId: string, trip: TripRef): Promise<Authority> {
    const employee = await this.workforce.getById(tenantId, trip.driverEmployeeId);
    return this.db.withTenant(tenantId, (client) => this.authorityWithClient(client, employee, trip));
  }

  /**
   * Refuses a driver action their authority doesn't cover. The owner and
   * dispatchers (logistics:dispatch) act on any trip in full — the owner
   * who drives their own route included.
   */
  async assertCan(tenantId: string, callerIsDispatcher: boolean, trip: TripRef, capability: Capability): Promise<void> {
    if (callerIsDispatcher) return;
    const authority = await this.authorityOnTrip(tenantId, trip);
    if (authority.can[capability]) return;
    const needed = CAPABILITY_LEVEL[capability];
    throw new ForbiddenException(
      authority.level === 0
        ? "You aren't authorized for this trip yet — the owner needs to approve it first."
        : `Your authority on this trip (level ${authority.level}: ${LEVEL_NAMES[authority.level]}) doesn't let you ${CAPABILITY_WORDS[capability]}. ` +
            `That needs level ${needed} — ask the owner.`,
    );
  }

  // ---- The driver pool ----

  pool(tenantId: string, actorUserId: string): Promise<DriverPoolEntry[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const rows = await this.delegations.driverPoolWithClient(client, actorUserId);
      const entries: DriverPoolEntry[] = [];
      for (const row of rows) {
        const authority = await this.authorityWithClient(
          client,
          { id: row.employeeId, delegationLevel: row.delegationLevel, standingDelegation: row.standingDelegation },
          null,
        );
        entries.push({
          ...row,
          authority,
          suggestedIndependent: row.tripsClosed >= 5 && row.closedClean / row.tripsClosed >= 0.9 && row.cashMismatches === 0,
        });
      }
      return entries;
    });
  }

  setEligibility(tenantId: string, actorUserId: string, employeeId: string, dto: SetEligibilityDto): Promise<EmployeeRecord> {
    return this.workforce.setDelegation(tenantId, actorUserId, employeeId, dto);
  }

  // ---- Grants ----

  recent(tenantId: string, limit = 50) {
    return this.db.withTenant(tenantId, (client) => this.delegations.listRecentWithClient(client, limit));
  }

  /**
   * Authorizes a driver at a level for one trip or until a set time. A
   * planned trip given to someone other than its driver is handed to them —
   * the trip's owner stays who planned it (delegation is not a transfer of
   * ownership); only who executes it changes.
   */
  async grant(tenantId: string, actorUserId: string, dto: GrantDelegationDto): Promise<DelegationRecord> {
    // Read before the transaction opens: one connection at a time per request.
    const driver = await this.eligibleDriver(tenantId, dto.driverEmployeeId, dto.level);
    return this.db.withTenant(tenantId, async (client) => {
      let endsAt: Date | null = null;
      if (dto.kind === 'temporary') {
        endsAt = new Date(dto.endsAt!);
        if (endsAt <= new Date()) throw new BadRequestException('A temporary delegation must end in the future');
      } else {
        await this.handTripTo(client, tenantId, actorUserId, dto.tripId!, driver);
      }
      const grant = await this.delegations.createWithClient(client, tenantId, actorUserId, {
        driverEmployeeId: driver.id,
        level: dto.level,
        kind: dto.kind,
        tripId: dto.kind === 'trip' ? dto.tripId! : null,
        endsAt,
        note: dto.note?.trim() || null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: DELEGATION_ENTITY,
        entityId: grant.id,
        after: grant as unknown as Record<string, unknown>,
      });
      return grant;
    });
  }

  revoke(tenantId: string, actorUserId: string, id: string): Promise<DelegationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.delegations.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Delegation not found');
      const after = await this.delegations.revokeWithClient(client, id, actorUserId);
      if (!after) throw new ConflictException('This delegation was already revoked');
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: DELEGATION_ENTITY,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  // ---- Day-off mode ----

  dayOff(tenantId: string): Promise<DayOffState> {
    return this.db.withTenant(tenantId, async (client) => {
      const settings = await this.settingsWithClient(client, tenantId);
      const away = !!settings.ownerAwayUntil && settings.ownerAwayUntil > new Date();
      const grants = (await this.delegations.listRecentWithClient(client, 20)).filter(
        (g) => g.kind === 'day_off' && !g.revokedAt && g.endsAt && g.endsAt > new Date(),
      );
      return { away, until: away ? settings.ownerAwayUntil : null, operatingDayEnd: settings.operatingDayEnd, grants };
    });
  }

  /**
   * "I'm unavailable today" (requirement: Owner's Day-Off Mode): a backup
   * driver runs the day at the level the owner picks, until the business's
   * operating day ends; the day's planned trips are handed to them. The
   * owner keeps watching remotely; only exceptions alert them.
   */
  async startDayOff(tenantId: string, actorUserId: string, dto: StartDayOffDto): Promise<DayOffState> {
    const driver = await this.eligibleDriver(tenantId, dto.driverEmployeeId, dto.level);
    return this.db.withTenant(tenantId, async (client) => {
      const settings = await this.settingsWithClient(client, tenantId);
      const until = operatingDayEnd(settings.operatingDayEnd, settings.timezone);
      for (const tripId of dto.tripIds ?? []) {
        await this.handTripTo(client, tenantId, actorUserId, tripId, driver);
      }
      const grant = await this.delegations.createWithClient(client, tenantId, actorUserId, {
        driverEmployeeId: driver.id,
        level: dto.level,
        kind: 'day_off',
        tripId: null,
        endsAt: until,
        note: dto.note?.trim() || null,
      });
      await client.query('UPDATE tenant.tenant SET owner_away_until = $2 WHERE id = $1', [tenantId, until]);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: DELEGATION_ENTITY,
        entityId: grant.id,
        after: { ...grant, tripIds: dto.tripIds ?? [] } as unknown as Record<string, unknown>,
      });
      return {
        away: true,
        until,
        operatingDayEnd: settings.operatingDayEnd,
        grants: [{ ...grant, driverName: driver.name, tripStatus: null }],
      };
    });
  }

  /** The owner is back: day-off grants end now. */
  endDayOff(tenantId: string, actorUserId: string): Promise<DayOffState> {
    return this.db.withTenant(tenantId, async (client) => {
      const ended = await this.delegations.revokeDayOffWithClient(client, actorUserId);
      await client.query('UPDATE tenant.tenant SET owner_away_until = NULL WHERE id = $1', [tenantId]);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: DELEGATION_ENTITY,
        entityId: tenantId,
        after: { dayOffEnded: true, grantsEnded: ended },
      });
      const settings = await this.settingsWithClient(client, tenantId);
      return { away: false, until: null, operatingDayEnd: settings.operatingDayEnd, grants: [] };
    });
  }

  // ---- Helpers ----

  /** Eligibility is checked before any authorization: the level can't exceed what the owner allowed for this person. */
  private async eligibleDriver(tenantId: string, employeeId: string, level: number): Promise<EmployeeRecord> {
    const driver = await this.workforce.getById(tenantId, employeeId);
    if (driver.roleType !== 'driver' || driver.status !== 'active') throw new BadRequestException(`${driver.name} isn't an active driver`);
    if (driver.delegationLevel === null) throw new ConflictException(`${driver.name} isn't eligible for delegation — set their level first`);
    if (level > driver.delegationLevel) {
      throw new ConflictException(`${driver.name} is eligible up to level ${driver.delegationLevel} (${LEVEL_NAMES[driver.delegationLevel as 1]}), not ${level}`);
    }
    return driver;
  }

  private async handTripTo(client: PoolClient, tenantId: string, actorUserId: string, tripId: string, driver: EmployeeRecord): Promise<void> {
    const trip = await this.trips.findByIdWithClient(client, tripId);
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driverEmployeeId === driver.id) {
      if (trip.status !== 'planned' && trip.status !== 'in_progress') {
        throw new ConflictException(`A ${trip.status} trip can't be delegated`);
      }
      return;
    }
    if (trip.status !== 'planned') {
      throw new ConflictException('Only a planned trip can be handed to another driver');
    }
    const after = await this.trips.assignDriverWithClient(client, tripId, driver.id);
    if (!after) throw new ConflictException('This trip was changed by someone else — reload and try again');
    await this.audit.record(client, {
      tenantId,
      actorUserId,
      action: 'update',
      entityType: 'trip',
      entityId: tripId,
      before: { driverEmployeeId: trip.driverEmployeeId },
      after: { driverEmployeeId: driver.id },
    });
  }

  private async settingsWithClient(client: PoolClient, tenantId: string) {
    const row = (
      await client.query<{ timezone: string; operating_day_end: string; owner_away_until: Date | null }>(
        'SELECT timezone, operating_day_end::text, owner_away_until FROM tenant.tenant WHERE id = $1',
        [tenantId],
      )
    ).rows[0];
    return {
      timezone: row?.timezone || 'Asia/Kolkata',
      operatingDayEnd: (row?.operating_day_end ?? '22:00:00').slice(0, 5),
      ownerAwayUntil: row?.owner_away_until ?? null,
    };
  }
}
