import { checklistOf, handoverOf } from './trip-closure';
import { TripReviewFacts } from './repositories/trip-reconciliations.repository';

const facts = (over: Partial<TripReviewFacts> = {}): TripReviewFacts => ({
  stops: [
    { id: 'p', type: 'pickup', status: 'completed', name: 'Ramesh Patil', notes: null, hasPod: false },
    { id: 'd1', type: 'delivery', status: 'completed', name: 'Hotel Sagar', notes: null, hasPod: true },
    { id: 'd2', type: 'delivery', status: 'completed', name: 'Deccan Dhaba', notes: null, hasPod: true },
  ],
  load: [{ product: 'Tomato', uom: 'kg', pickedUp: '100.000', delivered: '90.500', returned: '0.000' }],
  unpaidCashCustomers: [],
  expensesNeedingApproval: '0.00',
  ...over,
});

const handover = (declared: string | null = '1400.00') =>
  handoverOf({ advance: '500', cashCollections: '1200', spotCash: '0', expenses: '300', deposited: '0', declared, directPayments: '800' });

const area = (items: ReturnType<typeof checklistOf>, name: string) => items.find((i) => i.area === name)!;

describe('handoverOf', () => {
  it('expected = opening cash + cash collected + other cash − expenses − bank deposits', () => {
    const h = handoverOf({ advance: '1000', cashCollections: '4250.50', spotCash: '300', expenses: '450', deposited: '3000', declared: null, directPayments: '2000' });
    expect(h.expected).toBe('2100.50');
    // UPI/bank payments are shown, never part of the handover.
    expect(h.directPayments).toBe('2000.00');
  });

  it('counts backhaul rent paid in cash (driver app D5)', () => {
    const h = handoverOf({ advance: '500', cashCollections: '1200', spotCash: '0', backhaulCash: '3500', expenses: '300', deposited: '0', declared: null, directPayments: '0' });
    expect(h.backhaulCash).toBe('3500.00');
    expect(h.expected).toBe('4900.00');
  });
});

describe('checklistOf', () => {
  it('a trip that went to plan passes every area', () => {
    const items = checklistOf(facts(), handover(), '1400.00');
    expect(items.map((i) => i.status)).toEqual(Array(items.length).fill('pass'));
    expect(area(items, 'load').detail).toBe('Tomato: picked up 100 kg, delivered 90.5 kg.');
    expect(area(items, 'handover').detail).toBe('Received ₹1400.00, exactly as expected.');
  });

  it('cash counted short of expected is a handover exception saying by how much', () => {
    expect(area(checklistOf(facts(), handover(), '1350.00'), 'handover')).toEqual({
      area: 'handover',
      status: 'exception',
      detail: 'Received ₹1350.00 against ₹1400.00 expected: short by ₹50.00.',
    });
  });

  it('before counting, the driver declaration stands in; no declaration is itself an exception', () => {
    expect(area(checklistOf(facts(), handover('1400'), null), 'handover').status).toBe('pass');
    expect(area(checklistOf(facts(), handover(null), null), 'handover').detail).toMatch(/hasn't said/);
  });

  it('missed pickups, deliveries without proof, returns and unpaid cash customers are each an exception', () => {
    const items = checklistOf(
      facts({
        stops: [
          { id: 'p', type: 'pickup', status: 'skipped', name: 'Lakshmi Devi', notes: 'Farm closed', hasPod: false },
          { id: 'd1', type: 'delivery', status: 'completed', name: 'Hotel Sagar', notes: null, hasPod: false },
          { id: 'd2', type: 'delivery', status: 'skipped', name: 'Deccan Dhaba', notes: 'Shop shut', hasPod: false },
        ],
        load: [{ product: 'Onion', uom: 'kg', pickedUp: '0.000', delivered: '0.000', returned: '20.000' }],
        unpaidCashCustomers: [{ customer: 'Hotel Sagar', invoiced: '960.00', collected: '500.00' }],
      }),
      handover(),
      '1400.00',
    );
    expect(area(items, 'procurement').detail).toBe('Not picked up: Lakshmi Devi (Farm closed).');
    expect(area(items, 'deliveries').detail).toBe('No proof of delivery: Hotel Sagar.');
    expect(area(items, 'returns').detail).toBe('Not delivered: Deccan Dhaba (Shop shut). Back on the vehicle: 20 kg Onion.');
    expect(area(items, 'collections').detail).toBe("Cash customers who didn't pay in full: Hotel Sagar (paid ₹500.00 of ₹960.00).");
  });

  it('a trip with a backhaul has it checked after the returns; one without has no such check', () => {
    expect(checklistOf(facts(), handover(), '1400.00').some((i) => i.area === 'backhaul')).toBe(false);
    const at = new Date('2026-10-29T12:00:00Z');
    const items = checklistOf(
      facts({
        backhauls: [
          {
            id: 'b-1', tripId: 't-1', pickupPlace: 'Mysuru Market', dropPlace: 'Gundlupet Base', rent: '3500.00', hirerName: null, notes: null,
            offeredBy: 'owner', status: 'completed', skipReason: null, acceptedAt: at, pickupReachedAt: at, loadedAt: at, dropReachedAt: at,
            completedAt: at, cancelledAt: null, cancelReason: null, payment: null, photos: { load: 1, drop: 1, payment: 0 }, createdAt: at, version: 6,
          },
        ],
      }),
      handover(),
      '1400.00',
    );
    expect(items.map((i) => i.area).slice(3, 5)).toEqual(['returns', 'backhaul']);
    expect(area(items, 'backhaul').status).toBe('exception');
  });

  it("expenses beyond the driver's authority wait for the owner's approval", () => {
    const items = checklistOf(facts({ expensesNeedingApproval: '150.00' }), handover(), '1400.00');
    expect(area(items, 'expenses').status).toBe('exception');
    expect(area(items, 'expenses').detail).toContain("of which ₹150.00 beyond the driver's authority");
  });

  it('an expense the owner rejected is settled with the driver at closing; approved ones pass', () => {
    const rejected = checklistOf(facts({ expensesNeedingApproval: '0.00', expensesRejected: '120.00' }), handover(), '1400.00');
    expect(area(rejected, 'expenses')).toEqual({ area: 'expenses', status: 'exception', detail: '₹300.00 spent on the road, of which you rejected ₹120.00 — settle it with the driver.' });
    expect(area(checklistOf(facts({ expensesNeedingApproval: '0.00', expensesRejected: '0.00' }), handover(), '1400.00'), 'expenses').status).toBe('pass');
  });
  it('a vehicle count that is off at closing is a load exception; one that matches passes', () => {
    const off = checklistOf(facts(), handover(), '1400.00', [
      { productId: 'p1', product: 'Tomato', uom: 'kg', expected: '60.000', counted: '55.000' },
    ]);
    expect(area(off, 'load').status).toBe('exception');
    expect(area(off, 'load').detail).toMatch(/Tomato on the vehicle: counted 55 kg, expected 60 kg \(5 kg short\)/);
    const ok = checklistOf(facts(), handover(), '1400.00', [
      { productId: 'p1', product: 'Tomato', uom: 'kg', expected: '60.000', counted: '60.000' },
    ]);
    expect(area(ok, 'load').status).toBe('pass');
    expect(area(ok, 'load').detail).toMatch(/counted: as expected/);
  });
});

// Master Spec v3 §60 (P1): the areas every trip is checked on besides.
describe('checklistOf — workforce, workload, vehicle, exceptions, accounting', () => {
  const full = (over: Partial<TripReviewFacts> = {}) =>
    facts({
      workforce: { driver: 'Raju', workRecorded: true, hasPayRate: true, crewCredits: 2 },
      untimedStops: [],
      vehicle: { openingKm: '48620', closingKm: '48812', litres: '24.000' },
      openItems: [],
      books: { missing: [], unbalanced: 0 },
      ...over,
    });

  it('a trip that went to plan passes every area (backhaul is checked only on a trip that had one)', () => {
    const items = checklistOf(full(), handover(), '1400.00');
    expect(items.map((i) => i.area)).toEqual([
      'procurement', 'deliveries', 'load', 'returns', 'collections', 'handover', 'expenses',
      'workforce', 'workload', 'vehicle', 'exceptions', 'accounting',
    ]);
    expect(items.every((i) => i.status === 'pass')).toBe(true);
    expect(area(items, 'workforce').detail).toBe("Raju's work on this trip is recorded. 2 crew credits for loading.");
    expect(area(items, 'workload').detail).toBe('Arrival and completion times recorded at all 3 stops.');
    expect(area(items, 'vehicle').detail).toBe('192 km (48620 → 48812). 24 L of fuel put in (8.0 km/L).');
  });

  it("the driver's work not recorded is a workforce exception; no pay rate is said, not held against the trip", () => {
    expect(area(checklistOf(full({ workforce: { driver: 'Raju', workRecorded: false, hasPayRate: true, crewCredits: 0 } }), handover(), '1400.00'), 'workforce')).toEqual({
      area: 'workforce', status: 'exception', detail: "Raju's work on this trip isn't recorded.",
    });
    const noRate = area(checklistOf(full({ workforce: { driver: 'Raju', workRecorded: true, hasPayRate: false, crewCredits: 0 } }), handover(), '1400.00'), 'workforce');
    expect(noRate.status).toBe('pass');
    expect(noRate.detail).toMatch(/Raju has no pay rate on file/);
  });

  it('a completed stop without its arrival time is a workload exception naming it', () => {
    expect(area(checklistOf(full({ untimedStops: ['Hotel Sagar'] }), handover(), '1400.00'), 'workload')).toEqual({
      area: 'workload', status: 'exception', detail: 'No arrival or completion time at: Hotel Sagar.',
    });
  });

  it('no closing KM, or a day of more than 1,500 km, is a vehicle exception', () => {
    expect(area(checklistOf(full({ vehicle: { openingKm: '48620', closingKm: null, litres: '0' } }), handover(), '1400.00'), 'vehicle').detail).toBe('No closing KM recorded.');
    expect(area(checklistOf(full({ vehicle: { openingKm: null, closingKm: null, litres: '0' } }), handover(), '1400.00'), 'vehicle').detail).toBe('No opening KM recorded (nor closing).');
    const far = area(checklistOf(full({ vehicle: { openingKm: '48620', closingKm: '58620', litres: '0' } }), handover(), '1400.00'), 'vehicle');
    expect(far.status).toBe('exception');
    expect(far.detail).toMatch(/^10000 km in a day/);
  });

  it('an open dispute or request is an exceptions exception; a journal missing or unbalanced an accounting one', () => {
    expect(area(checklistOf(full({ openItems: ['a dispute from Hotel Sagar'] }), handover(), '1400.00'), 'exceptions').detail).toBe('Still open: a dispute from Hotel Sagar.');
    const books = area(checklistOf(full({ books: { missing: ['an expense of ₹300.00'], unbalanced: 1 } }), handover(), '1400.00'), 'accounting');
    expect(books).toEqual({ area: 'accounting', status: 'exception', detail: 'not in the books: an expense of ₹300.00; 1 journal doesn’t balance.' });
  });
});
