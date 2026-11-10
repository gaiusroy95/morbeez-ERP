import { failedChecks, TripCheckFacts, tripChecksOf } from './trip-checks';
import { stageOf } from './entities/trip.entity';

const facts = (over: Partial<TripCheckFacts> = {}): TripCheckFacts => ({
  today: '2026-11-09',
  plannedDate: '2026-11-09',
  driver: { name: 'Raju', active: true, hasLogin: true },
  vehicle: { registration: 'KA01D10001', capacityKg: '1500.00', roadworthy: true },
  stops: [
    { type: 'pickup', name: 'Ramesh Patil', status: 'scheduled', creditHold: false, outstanding: '0', lines: [{ product: 'Tomato', uom: 'kg', quantity: '500.000' }] },
    { type: 'delivery', name: 'Hotel Sagar', status: 'confirmed', creditHold: false, outstanding: '12500.00', lines: [{ product: 'Tomato', uom: 'kg', quantity: '300.000' }, { product: 'Onion', uom: 'g', quantity: '250000.000' }] },
  ],
  ...over,
});
const check = (f: TripCheckFacts, name: string) => tripChecksOf(f).find((c) => c.check === name)!;

describe('tripChecksOf — the owner’s Check before Publish (Master Spec v3 §7.4)', () => {
  it('a sound trip passes every check, saying what it found', () => {
    const checks = tripChecksOf(facts());
    expect(checks.map((c) => c.check)).toEqual(['driver', 'vehicle', 'date', 'stops', 'quantities', 'capacity', 'credit', 'collections']);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
    expect(check(facts(), 'capacity').detail).toBe('About 550 kg of 1,500 kg.'); // 300 kg + 250,000 g delivered beats 500 kg picked up
    expect(check(facts(), 'collections').detail).toBe('₹12500.00 owed by 1 customer on the trip.');
    expect(failedChecks(checks)).toEqual([]);
  });

  it('an inactive driver fails; one without an app login is a warning', () => {
    expect(check(facts({ driver: { name: 'Raju', active: false, hasLogin: true } }), 'driver').status).toBe('fail');
    expect(check(facts({ driver: { name: 'Raju', active: true, hasLogin: false } }), 'driver')).toEqual({
      check: 'driver', status: 'warn', detail: "Raju has no app login: give one under Workforce, or they won't see the trip.",
    });
  });

  it('a vehicle that may not go out fails, with the reason', () => {
    expect(check(facts({ vehicle: { registration: 'KA01D10001', capacityKg: '1500', roadworthy: 'KA01D10001: Insurance expired on 2026-11-01' } }), 'vehicle')).toEqual({
      check: 'vehicle', status: 'fail', detail: 'KA01D10001: Insurance expired on 2026-11-01',
    });
  });

  it('a date already passed fails; no date passes', () => {
    expect(check(facts({ plannedDate: '2026-11-08' }), 'date').status).toBe('fail');
    expect(check(facts({ plannedDate: null }), 'date').detail).toBe('No date: it runs whenever the driver starts it.');
    expect(check(facts({ plannedDate: '2026-11-10' }), 'date').detail).toBe('For 2026-11-10.');
  });

  it('no stops is a warning, not a failure (a spot-sale or backhaul day)', () => {
    expect(check(facts({ stops: [] }), 'stops').status).toBe('warn');
    expect(check(facts({ stops: [] }), 'quantities').status).toBe('pass');
  });

  it('an unconfirmed order, a pickup already made or a line without quantity fails', () => {
    const [pickup, delivery] = facts().stops;
    const bad = facts({ stops: [{ ...pickup, status: 'picked_up' }, { ...delivery, status: 'placed', lines: [{ product: 'Tomato', uom: 'kg', quantity: '0' }] }] });
    expect(check(bad, 'quantities')).toEqual({
      check: 'quantities',
      status: 'fail',
      detail: "Hotel Sagar's order is placed, not confirmed; the pickup at Ramesh Patil is picked_up; Hotel Sagar has no quantity.",
    });
    expect(failedChecks(tripChecksOf(bad)).map((c) => c.check)).toEqual(['quantities']);
  });

  it('more than the vehicle carries fails; lines not in kg are said, not guessed; no capacity on record is a warning', () => {
    const heavy = facts({ vehicle: { registration: 'KA01D10001', capacityKg: '400', roadworthy: true } });
    expect(check(heavy, 'capacity')).toEqual({ check: 'capacity', status: 'fail', detail: 'About 550 kg to carry on a 400 kg vehicle.' });
    const [pickup] = facts().stops;
    const crates = facts({ stops: [{ ...pickup, lines: [...pickup.lines, { product: 'Eggs', uom: 'piece', quantity: '300' }] }] });
    expect(check(crates, 'capacity').detail).toBe('About 500 kg of 1,500 kg (1 line not in kg not counted).');
    expect(check(facts({ vehicle: { registration: 'KA01D10001', capacityKg: '0', roadworthy: true } }), 'capacity').status).toBe('warn');
  });

  it('a customer on credit hold is a warning naming them', () => {
    const [pickup, delivery] = facts().stops;
    expect(check(facts({ stops: [pickup, { ...delivery, creditHold: true }] }), 'credit')).toEqual({ check: 'credit', status: 'warn', detail: 'On credit hold: Hotel Sagar.' });
  });
});

describe('stageOf — where a trip stands (Master Spec v3 §7)', () => {
  it('a planned trip is a draft until published; then on the road, submitted, closed', () => {
    expect(stageOf('planned', null)).toBe('draft');
    expect(stageOf('planned', new Date())).toBe('published');
    expect(stageOf('in_progress', new Date())).toBe('on_the_road');
    expect(stageOf('completed', new Date())).toBe('submitted');
    expect(stageOf('reconciled', new Date())).toBe('closed');
    expect(stageOf('cancelled', null)).toBe('cancelled');
    expect(stageOf('on_hold', new Date())).toBe('on_hold');
  });
});
