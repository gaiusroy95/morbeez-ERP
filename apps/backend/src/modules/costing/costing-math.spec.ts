import {
  allocateTrip,
  COMPONENTS,
  Components,
  CostStop,
  financeCostOf,
  largestRemainder,
  LOAD_COMPONENTS,
  perKg,
  rateDifference,
  RUNNING_COMPONENTS,
  runningKeys,
  rupeeDays,
  sumOf,
  vehicleShare,
  verifiedServiceMinutes,
  zeroComponents,
} from './costing-math';

// Master Spec v3 P5 — rules C1–C6.
const pools = (over: Partial<Record<keyof Components, number>>): Components => {
  const c = zeroComponents();
  for (const [k, v] of Object.entries(over)) c[k as keyof Components] = BigInt(Math.round((v as number) * 100));
  return c;
};
const line = (key: string, kg: number | null, value = 0, kind: 'order_line' | 'lot' = 'order_line') => ({
  key,
  kind,
  productId: `p-${key}`,
  kgMilli: kg === null ? null : BigInt(Math.round(kg * 1000)),
  valueCents: BigInt(Math.round(value * 100)),
});
const delivery = (stopId: string, lines: ReturnType<typeof line>[], extra: Partial<CostStop> = {}): CostStop => ({
  stopId,
  kind: 'delivery',
  customerId: `c-${stopId}`,
  serviceMinutes: null,
  customerHasHistory: false,
  lines,
  ...extra,
});
const allocatedTotal = (rows: { components: Components }[]) => rows.reduce((s, r) => s + sumOf(r.components), 0n);

describe('largestRemainder', () => {
  it('splits exactly, the odd paise to the largest remainders, ties to the earlier', () => {
    expect(largestRemainder(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(largestRemainder(1000n, [333n, 333n, 334n])).toEqual([333n, 333n, 334n]);
    expect(largestRemainder(7n, [0n, 0n])).toEqual([4n, 3n]); // all-zero weights: equal
    expect(largestRemainder(5n, [])).toBeNull(); // nothing to carry it
  });

  it('never loses a paisa over awkward weights', () => {
    const parts = largestRemainder(123457n, [7n, 13n, 29n, 31n, 1n]) as bigint[];
    expect(parts.reduce((s, p) => s + p, 0n)).toBe(123457n);
  });
});

describe('verifiedServiceMinutes (C2)', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 9, m));
  it('counts arrival to completion, phone-stamped, at most 3 hours', () => {
    expect(verifiedServiceMinutes(at(0), at(25))).toBe(25);
    expect(verifiedServiceMinutes(at(0), new Date(at(0).getTime() + 181 * 60_000))).toBeNull();
    expect(verifiedServiceMinutes(at(10), at(5))).toBeNull();
    expect(verifiedServiceMinutes(null, at(5))).toBeNull();
  });
});

describe('runningKeys (D1: α by KG, the rest by verified service minutes)', () => {
  it('KG alone until a customer has the history', () => {
    const stops = [delivery('a', [line('a1', 300)], { serviceMinutes: 50 }), delivery('b', [line('b1', 100)], { serviceMinutes: 10 })];
    expect(runningKeys(stops, 5000n)).toEqual([300_000n, 100_000n]);
  });

  it('50/50 between KG and minutes when every customer has the history', () => {
    // KG shares ¾ / ¼; minutes shares 1/6 and 5/6 → keys ½·¾ + ½·⅙ = 11/24 and ½·¼ + ½·⅚ = 13/24.
    const stops = [
      delivery('a', [line('a1', 300)], { serviceMinutes: 10, customerHasHistory: true }),
      delivery('b', [line('b1', 100)], { serviceMinutes: 50, customerHasHistory: true }),
    ];
    const [ka, kb] = runningKeys(stops, 5000n);
    expect(ka * 13n).toBe(kb * 11n);
  });

  it('a customer without history keeps exactly their KG share; the others share theirs by minutes', () => {
    const stops = [
      delivery('a', [line('a1', 200)], { serviceMinutes: 30, customerHasHistory: true }),
      delivery('b', [line('b1', 200)], { serviceMinutes: 10, customerHasHistory: true }),
      delivery('c', [line('c1', 400)], { serviceMinutes: 99, customerHasHistory: false }),
    ];
    const keys = runningKeys(stops, 5000n);
    const total = keys.reduce((s, k) => s + k, 0n);
    expect(keys[2] * 2n).toBe(total); // c: 400 of 800 kg = ½, untouched by minutes
    // a and b share their ½ by 50% KG (¼ each) + 50% minutes (¾ / ¼ of ½): a = ⅛ + 3/16 = 5/16, b = ⅛ + 1/16 = 3/16.
    expect(keys[0] * 16n).toBe(total * 5n);
    expect(keys[1] * 16n).toBe(total * 3n);
  });
});

describe('allocateTrip (C2–C4: every rupee once)', () => {
  it('splits each component to the lines exactly, running by the key, load by KG delivered', () => {
    const p = pools({ fuel: 1000.01, tolls: 240, vehicle: 333.33, labour: 150, writtenOff: 99.99, driverIncentives: 75 });
    const stops = [delivery('a', [line('a1', 120), line('a2', 30)]), delivery('b', [line('b1', 50)]), delivery('c', [line('c1', 100)])];
    const r = allocateTrip(p, stops, 5000n);
    expect(allocatedTotal(r.rows)).toBe(sumOf(p));
    for (const c of COMPONENTS) expect(r.rows.reduce((s, x) => s + x.components[c], 0n)).toBe(p[c]);
    expect(sumOf(r.unallocated)).toBe(0n);
    // KG only (no history): a1 has 120 of 300 kg → 40% of fuel 1000.01 = 400.00(4) → 400.00 or 400.01.
    const a1 = r.rows.find((x) => x.key === 'a1') as (typeof r.rows)[number];
    expect(a1.components.fuel === 40000n || a1.components.fuel === 40001n).toBe(true);
    expect(r.deliveredKgMilli).toBe(300_000n);
  });

  it('a pickup carries the running pool by KG received; the load pool stays with the deliveries', () => {
    const p = pools({ fuel: 300, labour: 90 });
    const stops: CostStop[] = [
      { stopId: 'farm', kind: 'pickup', customerId: null, serviceMinutes: null, customerHasHistory: false, lines: [line('lot1', 200, 4000, 'lot')] },
      delivery('a', [line('a1', 100)]),
    ];
    const r = allocateTrip(p, stops, 5000n);
    const lot = r.rows.find((x) => x.key === 'lot1') as (typeof r.rows)[number];
    const a1 = r.rows.find((x) => x.key === 'a1') as (typeof r.rows)[number];
    expect([lot.components.fuel, a1.components.fuel]).toEqual([20000n, 10000n]);
    expect([lot.components.labour, a1.components.labour]).toEqual([0n, 9000n]);
    expect(r.pickupKgMilli).toBe(200_000n);
  });

  it('a line with no weight carries no KG share and is counted; a stop of only unweighted lines splits by value', () => {
    const p = pools({ fuel: 100 });
    const stops = [delivery('a', [line('a1', 100), line('egg', null, 600)]), delivery('b', [line('b1', 100)])];
    const r = allocateTrip(p, stops, 5000n);
    expect(r.unweightedLines).toBe(1);
    expect(r.rows.find((x) => x.key === 'egg')?.components.fuel).toBe(0n);
    const onlyEggs = allocateTrip(p, [delivery('e', [line('e1', null, 300), line('e2', null, 100)])], 5000n);
    expect(onlyEggs.rows.map((x) => x.components.fuel)).toEqual([7500n, 2500n]);
  });

  it('with nowhere to go it stays unallocated, with the reason — and still adds up', () => {
    const p = pools({ fuel: 500, labour: 80 });
    const r = allocateTrip(p, [delivery('a', [line('a1', 0, 0)])], 5000n); // the delivery failed: nothing delivered
    expect(r.rows.length).toBe(0);
    expect(sumOf(r.unallocated)).toBe(sumOf(p));
    expect(r.unallocatedReason).toMatch(/No delivery or pickup/);
  });

  it('a failed delivery for a customer with history still shares the running pool by its minutes — never the load pool', () => {
    const p = pools({ fuel: 200, labour: 60 });
    const stops = [
      delivery('a', [line('a1', 100)], { serviceMinutes: 20, customerHasHistory: true }),
      delivery('b', [line('b1', 0, 0)], { serviceMinutes: 20, customerHasHistory: true }),
    ];
    const r = allocateTrip(p, stops, 5000n);
    expect(allocatedTotal(r.rows)).toBe(sumOf(p));
    expect(r.rows.find((x) => x.key === 'b1')?.components.labour).toBe(0n);
  });

  it('every running and load component is accounted for', () => {
    expect([...RUNNING_COMPONENTS, ...LOAD_COMPONENTS].sort()).toEqual([...COMPONENTS].sort());
  });
});

describe('vehicleShare (C1)', () => {
  it('the trip km × the vehicle cost per km over the window, half-up', () => {
    // ₹9,000 over 1,500.0 km = ₹6/km; a 48.5 km trip carries ₹291.00.
    expect(vehicleShare(900_000n, 15_000n, 485n)).toEqual({ share: 29_100n, ratePerKm: '6.0000' });
    // ₹1,000 over 333.3 km = ₹3.0003/km; 10.0 km → ₹30.00 (30.003 → 30.00).
    expect(vehicleShare(100_000n, 3_333n, 100n)).toEqual({ share: 3_000n, ratePerKm: '3.0003' });
  });

  it('no km recorded, or no costs: nothing', () => {
    expect(vehicleShare(900_000n, 0n, 485n)).toEqual({ share: 0n, ratePerKm: null });
    expect(vehicleShare(0n, 15_000n, 485n).share).toBe(0n);
  });
});

describe('rates per KG (C5)', () => {
  it('₹ per KG to 4 dp, and the variance exactly', () => {
    expect(perKg(150_000n, 600_000n)).toBe('2.5000'); // ₹1,500 over 600 kg
    expect(perKg(100n, 3_000n)).toBe('0.3333');
    expect(perKg(100n, 0n)).toBeNull();
    expect(rateDifference('2.5000', '2.1250')).toBe('0.3750');
    expect(rateDifference('2.0000', '2.1250')).toBe('-0.1250');
  });
});

describe('rupeeDays and financeCostOf (MS §31; C6)', () => {
  it('what was owed, day by day, partial payments lowering it from the day they landed', () => {
    // ₹10,000 owed for 10 days, then ₹4,000 paid: ₹6,000 for 20 more days.
    const pd = rupeeDays({ amountCents: 1_000_000n, issuedOn: '2026-10-01', reductions: [{ on: '2026-10-11', cents: 400_000n }] }, '2026-10-31');
    expect(pd).toBe(1_000_000n * 10n + 600_000n * 20n);
    // At 18% a year: 220,000 rupee-days × 18% ÷ 365 = ₹108.49.
    expect(financeCostOf(pd, '18.00')).toBe(10_849n);
  });

  it('stops when settled; nothing before issue or after the end', () => {
    expect(rupeeDays({ amountCents: 50_000n, issuedOn: '2026-10-01', reductions: [{ on: '2026-10-05', cents: 50_000n }] }, '2026-12-31')).toBe(50_000n * 4n);
    expect(rupeeDays({ amountCents: 50_000n, issuedOn: '2026-10-10', reductions: [] }, '2026-10-10')).toBe(0n);
    expect(financeCostOf(0n, '18.00')).toBe(0n);
  });
});
