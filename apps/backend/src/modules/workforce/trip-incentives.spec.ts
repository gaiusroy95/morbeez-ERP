import { dayPayOf, fuelSaved, IncentiveRules, incentivesOf, INCENTIVE_KINDS, TripFacts, wasNight } from './trip-incentives';

const facts = (over: Partial<TripFacts> = {}): TripFacts => ({
  outcome: 'pass',
  dayPay: '1200.00',
  collected: '152000.00',
  backhaulReceived: '3500.00',
  deliveredValue: '150000.00',
  deliveries: 5,
  shortDeliveries: 0,
  stops: 8,
  skippedStops: 0,
  cratesBack: 20,
  cratesValue: '20000.00',
  newCustomers: 1,
  newCustomerValue: '10000.00',
  startedAt: '06:12',
  endedAt: '18:20',
  overnight: false,
  hasOpeningKm: true,
  hasClosingKm: true,
  deliveriesWithoutPhoto: 0,
  expensesWithoutBill: 0,
  mileage: { km: 620, litres: '65.400', cost: '6049.50' },
  ...over,
});

const PERCENT: Record<string, string> = {
  collection: '0.200',
  backhaul: '10.000',
  mileage: '50.000',
  crates: '1.000',
  quality: '0.100',
  new_customer: '2.000',
  performance: '0.200',
  night_duty: '25.000',
  data_quality: '10.000',
  completion: '20.000',
};
const rules = (over: Partial<IncentiveRules> = {}): IncentiveRules => ({
  rules: INCENTIVE_KINDS.map((kind) => ({ kind, enabled: true, percent: PERCENT[kind] })),
  targetKmPerLitre: '8.50',
  nightFrom: '21:00',
  nightUntil: '05:00',
  ...over,
});
const amounts = (f: TripFacts, r = rules()) => Object.fromEntries(incentivesOf(f, r).map((l) => [l.kind, l.amount]));

describe('the incentive engine (driver app D7)', () => {
  it('each a percentage of its base — a good day', () => {
    expect(amounts(facts())).toEqual({
      collection: '304.00', // 0.2% of 1,52,000
      backhaul: '350.00', // 10% of 3,500
      mileage: '348.77', // 50% of 7.541 L saved at 92.50
      crates: '200.00', // 1% of 20,000
      quality: '150.00', // 0.1% of 1,50,000 delivered, none short
      new_customer: '200.00', // 2% of a 10,000 first delivery
      performance: '300.00', // 0.2% of 1,50,000, every stop done
      night_duty: '0.00',
      data_quality: '120.00', // 10% of the day's 1,200
      completion: '240.00', // 20% of 1,200, closed as a pass
    });
  });

  it('only what the owner switched on', () => {
    const only = rules({ rules: [{ kind: 'backhaul', enabled: true, percent: '10.000' }, { kind: 'collection', enabled: false, percent: '1.000' }] });
    expect(incentivesOf(facts(), only).map((l) => l.kind)).toEqual(['backhaul']);
    expect(incentivesOf(facts(), rules({ rules: [] }))).toEqual([]);
  });

  it('nothing earned says why', () => {
    const lines = incentivesOf(
      facts({ collected: '0.00', backhaulReceived: '0.00', shortDeliveries: 1, skippedStops: 2, cratesBack: 0, newCustomers: 0, expensesWithoutBill: 1, outcome: 'approved_exception', mileage: null }),
      rules(),
    );
    const why = Object.fromEntries(lines.map((l) => [l.kind, `${l.amount} ${l.detail}`]));
    expect(why).toMatchObject({
      collection: '0.00 Nothing collected',
      backhaul: '0.00 No backhaul paid',
      mileage: '0.00 No full tank on this trip — mileage is judged at the next one',
      crates: '0.00 No crates brought back',
      quality: '0.00 1 delivery(ies) short',
      performance: '0.00 2 stop(s) not done',
      data_quality: '0.00 1 expense(s) without a bill',
      completion: '0.00 Closed with an exception',
    });
  });

  it('before the close, completion is what a pass would pay', () => {
    expect(amounts(facts({ outcome: null })).completion).toBe('240.00');
  });

  it('no fixed daily pay, no incentive on it', () => {
    const a = amounts(facts({ dayPay: null }));
    expect([a.data_quality, a.completion, a.night_duty]).toEqual(['0.00', '0.00', '0.00']);
  });

  it('night duty: set off before the night ends, back after it starts, or back the next day', () => {
    expect(wasNight({ startedAt: '04:30', endedAt: '14:00', overnight: false }, '21:00', '05:00')).toBe(true);
    expect(wasNight({ startedAt: '06:00', endedAt: '21:15', overnight: false }, '21:00', '05:00')).toBe(true);
    expect(wasNight({ startedAt: '19:00', endedAt: '01:30', overnight: true }, '21:00', '05:00')).toBe(true);
    expect(wasNight({ startedAt: '06:00', endedAt: '20:59', overnight: false }, '21:00', '05:00')).toBe(false);
    expect(amounts(facts({ endedAt: '22:10' })).night_duty).toBe('300.00');
  });

  it('the fuel saved against the target, at its cost', () => {
    // 620 km at 8.5 km/l is 72.941 L; 65.4 L used — 7.541 L saved at ₹92.50
    expect(fuelSaved({ km: 620, litres: '65.400', cost: '6049.50' }, '8.50')).toEqual({ litres: '7.541', value: '697.54' });
    expect(fuelSaved({ km: 500, litres: '65.400', cost: '6049.50' }, '8.50')).toEqual({ litres: '0.000', value: '0.00' });
    expect(fuelSaved(null, '8.50')).toBeNull();
    expect(amounts(facts(), rules({ targetKmPerLitre: null })).mileage).toBe('0.00');
  });

  it("the day's fixed pay from the pay rate", () => {
    expect(dayPayOf({ payBasis: 'daily', rate: '1200.00' }, '2026-10-30')).toBe('1200.00');
    expect(dayPayOf({ payBasis: 'monthly', rate: '31000.00' }, '2026-10-30')).toBe('1000.00');
    expect(dayPayOf({ payBasis: 'monthly', rate: '30000.00' }, '2026-02-10')).toBe('1071.43');
    expect(dayPayOf({ payBasis: 'hourly', rate: '150.00' }, '2026-10-30')).toBe('1200.00');
    expect(dayPayOf({ payBasis: 'piece', rate: '2.00' }, '2026-10-30')).toBeNull();
    expect(dayPayOf(null, '2026-10-30')).toBeNull();
  });
});
