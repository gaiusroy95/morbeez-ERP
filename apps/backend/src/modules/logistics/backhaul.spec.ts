import { backhaulCheckOf, handoverHoldOf, happenedAt, nextStepOf, returnHoldOf, stepProblemOf } from './backhaul';
import { BackhaulRecord } from './entities/backhaul.entity';

const at = new Date('2026-10-29T11:20:00Z');

const backhaul = (over: Partial<BackhaulRecord> = {}): BackhaulRecord => ({
  id: 'b-1',
  tripId: 't-1',
  pickupPlace: 'Mysuru Market',
  dropPlace: 'Gundlupet Base',
  rent: '3500.00',
  hirerName: null,
  notes: null,
  offeredBy: 'owner',
  status: 'offered',
  skipReason: null,
  acceptedAt: null,
  pickupReachedAt: null,
  loadedAt: null,
  dropReachedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  payment: null,
  photos: { load: 0, drop: 0, payment: 0 },
  createdAt: at,
  version: 1,
  ...over,
});

const accepted = (over: Partial<BackhaulRecord> = {}) => backhaul({ status: 'accepted', acceptedAt: at, ...over });
const done = (over: Partial<BackhaulRecord> = {}) =>
  backhaul({
    status: 'completed',
    acceptedAt: at,
    pickupReachedAt: at,
    loadedAt: at,
    dropReachedAt: at,
    completedAt: at,
    photos: { load: 1, drop: 1, payment: 0 },
    ...over,
  });

describe('backhaul steps', () => {
  it('run pickup reached → loaded → drop reached → completed, once accepted', () => {
    expect(nextStepOf(backhaul())).toBeNull();
    expect(nextStepOf(accepted())).toBe('pickup_reached');
    expect(nextStepOf(accepted({ pickupReachedAt: at }))).toBe('loaded');
    expect(nextStepOf(accepted({ pickupReachedAt: at, loadedAt: at, dropReachedAt: at }))).toBe('completed');
    expect(nextStepOf(done())).toBeNull();
  });

  it('refuse a step out of order, before accepting, or after a skip', () => {
    expect(stepProblemOf(backhaul(), 'pickup_reached')).toBe('Accept the backhaul first');
    expect(stepProblemOf(accepted(), 'drop_reached')).toBe('Pickup reached comes first');
    expect(stepProblemOf(backhaul({ status: 'skipped', skipReason: 'No time' }), 'pickup_reached')).toBe('This backhaul was skipped');
    expect(stepProblemOf(accepted(), 'pickup_reached')).toBeNull();
  });

  it('need the load photographed before it is loaded, and the drop before it is completed', () => {
    const reached = accepted({ pickupReachedAt: at });
    expect(stepProblemOf(reached, 'loaded')).toBe('Take a photo of the load first');
    expect(stepProblemOf({ ...reached, photos: { load: 1, drop: 0, payment: 0 } }, 'loaded')).toBeNull();
    const dropped = accepted({ pickupReachedAt: at, loadedAt: at, dropReachedAt: at, photos: { load: 1, drop: 0, payment: 0 } });
    expect(stepProblemOf(dropped, 'completed')).toBe('Take a photo at the drop first');
  });

  it('take a step already recorded as the same request again', () => {
    expect(stepProblemOf(done(), 'pickup_reached')).toBeNull();
  });

  it("are dated by the phone's clock — never in the future, never before the step before", () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const reached = accepted({ pickupReachedAt: new Date('2026-10-29T11:20:00Z') });
    expect(happenedAt(reached, '2026-10-29T11:45:00Z', now).toISOString()).toBe('2026-10-29T11:45:00.000Z');
    expect(happenedAt(reached, '2026-10-29T13:00:00Z', now)).toEqual(now);
    expect(happenedAt(reached, '2026-10-29T10:00:00Z', now).toISOString()).toBe('2026-10-29T11:20:00.000Z');
    expect(happenedAt(reached, undefined, now)).toEqual(now);
  });
});

describe('the backhaul holds', () => {
  it('keep the vehicle out (Return) while an offer is unanswered or a backhaul is under way', () => {
    expect(returnHoldOf([backhaul()])).toBe('Accept or skip the backhaul Mysuru Market → Gundlupet Base first');
    expect(returnHoldOf([accepted()])).toBe('Finish the backhaul Mysuru Market → Gundlupet Base first');
    expect(returnHoldOf([done()])).toBeNull();
    expect(returnHoldOf([backhaul({ status: 'skipped', skipReason: 'No time' }), backhaul({ status: 'cancelled', cancelledAt: at })])).toBeNull();
  });

  it('keep the driver from handing over until the rent is recorded', () => {
    expect(handoverHoldOf([done()])).toBe('Record the payment for the backhaul Mysuru Market → Gundlupet Base first');
    expect(handoverHoldOf([done({ payment: { method: 'upi', amount: '3500.00', reference: 'UTR1', note: null, paidAt: at } })])).toBeNull();
  });
});

describe('the backhaul check at closing', () => {
  it('is left out when the trip had none (or only cancelled ones)', () => {
    expect(backhaulCheckOf([])).toBeNull();
    expect(backhaulCheckOf([backhaul({ status: 'cancelled', cancelledAt: at })])).toBeNull();
  });

  it('passes a backhaul paid in full, and one skipped with its reason', () => {
    expect(backhaulCheckOf([done({ payment: { method: 'cash', amount: '3500.00', reference: null, note: null, paidAt: at } })])).toEqual({
      area: 'backhaul',
      status: 'pass',
      detail: 'Mysuru Market → Gundlupet Base: ₹3500.00 received by cash.',
    });
    expect(backhaulCheckOf([backhaul({ status: 'skipped', skipReason: 'Vehicle needed back early' })])?.detail).toBe(
      'Mysuru Market → Gundlupet Base: skipped (Vehicle needed back early).',
    );
  });

  it('is an exception for rent short or not received, and a backhaul never answered or left half-done', () => {
    const short = backhaulCheckOf([done({ payment: { method: 'upi', amount: '3000.00', reference: 'UTR1', note: null, paidAt: at } })]);
    expect(short?.status).toBe('exception');
    expect(short?.detail).toBe('Mysuru Market → Gundlupet Base: received ₹3000.00 of ₹3500.00 rent (₹500.00 short).');
    expect(backhaulCheckOf([done()])?.detail).toBe('Mysuru Market → Gundlupet Base: rent of ₹3500.00 not received.');
    expect(backhaulCheckOf([backhaul()])?.detail).toBe('Mysuru Market → Gundlupet Base: never accepted or skipped.');
    expect(backhaulCheckOf([accepted()])?.detail).toBe('Mysuru Market → Gundlupet Base: started but not completed.');
  });
});
