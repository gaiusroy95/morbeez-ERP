import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { sumMoney } from '../../common/money';
import { PayrollService } from '../workforce/payroll.service';
import { FleetService } from '../vehicles/fleet.service';
import { IncentiveKind, IncentiveLine, incentivesOf, INCENTIVE_LABEL } from '../workforce/trip-incentives';
import { TripIncentivesRepository } from './repositories/trip-incentives.repository';
import { TripRecord } from './entities/trip.entity';
import { TripIncentives } from './entities/driver-records.entity';

/**
 * The incentive engine's trip side (driver app D7): reads what a trip did
 * and the driver's day pay, and works out their incentives under the
 * owner's rules — kept when the owner closes the trip (Payroll pays them
 * with the week), estimated while it's still open.
 */
@Injectable()
export class TripIncentivesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TripIncentivesRepository,
    private readonly payroll: PayrollService,
    private readonly fleet: FleetService,
  ) {}

  /** The trip's incentives under the rules now; [outcome] null for an estimate before the close. */
  async workOutWithClient(
    client: PoolClient,
    tripId: string,
    outcome: 'pass' | 'approved_exception' | null,
  ): Promise<{ employeeId: string; workDate: string; lines: IncentiveLine[] } | null> {
    const facts = await this.repo.factsWithClient(client, tripId);
    if (!facts) return null;
    const { employeeId, vehicleId, workDate, ...trip } = facts;
    const rules = await this.payroll.incentiveRulesWithClient(client);
    if (!rules.rules.some((r) => r.enabled)) return { employeeId, workDate, lines: [] };
    const dayPay = await this.payroll.dayPayWithClient(client, employeeId, workDate);
    const mileage = await this.fleet.mileageForTripWithClient(client, vehicleId, tripId);
    return { employeeId, workDate, lines: incentivesOf({ ...trip, outcome, dayPay, mileage }, rules) };
  }

  /** At the owner's close, inside its transaction: worked out once and kept — later changes to the rules don't rewrite it. */
  async recordAtCloseWithClient(client: PoolClient, tenantId: string, userId: string, tripId: string, outcome: 'pass' | 'approved_exception'): Promise<void> {
    const worked = await this.workOutWithClient(client, tripId, outcome);
    if (!worked || worked.lines.length === 0) return;
    await this.payroll.recordTripIncentivesWithClient(client, tenantId, userId, { id: tripId, employeeId: worked.employeeId, workDate: worked.workDate }, worked.lines);
  }

  /** A trip's incentives: as kept at its close; before it, what the trip would pay now (an estimate). */
  async forTripWithClient(client: PoolClient, trip: TripRecord): Promise<TripIncentives> {
    const view = (final: boolean, lines: { kind: string; base: string; percent: string; amount: string; detail: string }[]): TripIncentives => ({
      tripId: trip.id,
      tripNumber: trip.number,
      final,
      lines: lines.map((l) => ({ ...l, label: INCENTIVE_LABEL[l.kind as IncentiveKind] ?? l.kind })),
      total: sumMoney(lines.map((l) => l.amount)),
    });
    if (trip.status === 'reconciled') return view(true, await this.payroll.tripIncentivesWithClient(client, { tripId: trip.id }));
    if (trip.status === 'planned' || trip.status === 'cancelled') return view(false, []);
    return view(false, (await this.workOutWithClient(client, trip.id, null))?.lines ?? []);
  }

  forTrip(tenantId: string, trip: TripRecord): Promise<TripIncentives> {
    return this.db.withTenant(tenantId, (client) => this.forTripWithClient(client, trip));
  }
}
