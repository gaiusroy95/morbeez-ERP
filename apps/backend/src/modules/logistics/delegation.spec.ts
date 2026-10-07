import { authorityOf, DelegationRecord, operatingDayEnd } from './delegation';

const now = new Date('2026-10-02T06:00:00Z');
const grant = (over: Partial<DelegationRecord>): DelegationRecord => ({
  id: 'g',
  driverEmployeeId: 'e',
  level: 2,
  kind: 'temporary',
  tripId: null,
  endsAt: new Date('2026-10-02T12:00:00Z'),
  note: null,
  grantedBy: 'owner',
  grantedAt: new Date('2026-10-01T00:00:00Z'),
  revokedAt: null,
  revokedBy: null,
  ...over,
});
const trip = { id: 't1', status: 'in_progress' };

describe('authorityOf', () => {
  it('a standing permission authorizes at the eligibility level', () => {
    const a = authorityOf({ delegationLevel: 2, standingDelegation: true }, [], trip, now);
    expect(a.level).toBe(2);
    expect(a.source).toBe('standing');
    expect(a.can).toEqual({ deliver: true, collect: true, deposit: true, spot_sale: true, procure: false, expense: false });
  });

  it('eligibility alone authorizes nothing', () => {
    const a = authorityOf({ delegationLevel: 4, standingDelegation: false }, [], trip, now);
    expect(a.level).toBe(0);
    expect(a.can.deliver).toBe(false);
  });

  it('a trip grant covers that trip until its handover, and no other', () => {
    const g = grant({ kind: 'trip', tripId: 't1', endsAt: null, level: 4 });
    const employee = { delegationLevel: 4, standingDelegation: false };
    expect(authorityOf(employee, [g], trip, now)).toMatchObject({ level: 4, source: 'trip' });
    expect(authorityOf(employee, [g], { id: 't2', status: 'in_progress' }, now).level).toBe(0);
    expect(authorityOf(employee, [g], { id: 't1', status: 'completed' }, now).level).toBe(0);
  });

  it('day-off and temporary grants lapse at their end, and revoked ones never count', () => {
    const employee = { delegationLevel: 3, standingDelegation: false };
    expect(authorityOf(employee, [grant({ kind: 'day_off', level: 3 })], trip, now)).toMatchObject({ level: 3, source: 'day_off' });
    expect(authorityOf(employee, [grant({ endsAt: new Date('2026-10-02T05:00:00Z') })], trip, now).level).toBe(0);
    expect(authorityOf(employee, [grant({ revokedAt: now, revokedBy: 'owner' })], trip, now).level).toBe(0);
  });

  it('a grant never lifts a driver above what they are eligible for', () => {
    const a = authorityOf({ delegationLevel: 2, standingDelegation: true }, [grant({ level: 4 })], trip, now);
    expect(a.level).toBe(2);
    expect(a.can.procure).toBe(false);
  });

  it('the higher of standing and granted wins', () => {
    const a = authorityOf({ delegationLevel: 4, standingDelegation: true }, [grant({ level: 1 })], trip, now);
    expect(a).toMatchObject({ level: 4, source: 'standing' });
  });
});

describe('operatingDayEnd', () => {
  it("is today's day end in the business's timezone", () => {
    // 11:30 in Kolkata; the day ends at 22:00 there, 16:30 UTC.
    expect(operatingDayEnd('22:00', 'Asia/Kolkata', new Date('2026-10-02T06:00:00Z')).toISOString()).toBe('2026-10-02T16:30:00.000Z');
  });

  it("is tomorrow's once today's has passed", () => {
    expect(operatingDayEnd('22:00:00', 'Asia/Kolkata', new Date('2026-10-02T17:00:00Z')).toISOString()).toBe('2026-10-03T16:30:00.000Z');
  });

  it('rolls over a month end', () => {
    expect(operatingDayEnd('06:00', 'Asia/Kolkata', new Date('2026-10-31T02:00:00Z')).toISOString()).toBe('2026-11-01T00:30:00.000Z');
  });
});
