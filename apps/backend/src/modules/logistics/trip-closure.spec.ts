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

  it("expenses beyond the driver's authority wait for the owner's approval", () => {
    const items = checklistOf(facts({ expensesNeedingApproval: '150.00' }), handover(), '1400.00');
    expect(area(items, 'expenses').status).toBe('exception');
    expect(area(items, 'expenses').detail).toContain("of which ₹150.00 beyond the driver's authority");
  });
});
