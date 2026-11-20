import { PoolClient } from 'pg';
import { CostingService, toStops } from './costing.service';
import { StopLineRow } from './costing.repository';
import { contributionAt, financeByLine } from './contribution';
import { ContributionLevel } from './costing.entity';

// Master Spec v3 P5 — rules C1–C6 through the service, against a stand-in repository.
const client = {} as PoolClient;
const closedAt = new Date('2026-11-10T12:00:00Z');

function stopRow(over: Partial<StopLineRow>): StopLineRow {
  return {
    stop_id: 's1',
    stop_type: 'delivery',
    status: 'completed',
    customer_id: 'c1',
    arrived_at: null,
    completed_at: null,
    key: 'l1',
    product_id: 'p1',
    kg: '100.000',
    value: '5000.00',
    ...over,
  };
}

function build(opts: { hasCost?: boolean; standard?: { basis: 'route' | 'business'; costCents: bigint; kgMilli: bigint; trips: number } | null } = {}) {
  const inserted: { cost?: Record<string, unknown>; rows?: unknown[] } = {};
  const repo = {
    hasCostWithClient: jest.fn().mockResolvedValue(opts.hasCost ?? false),
    tripWithClient: jest.fn().mockResolvedValue({
      id: 't1',
      number: 'T-0001',
      vehicleId: 'v1',
      routeId: 'r1',
      driverEmployeeId: 'd1',
      openingKm: '1000.0',
      closingKm: '1048.5',
      closedAt,
      closedOn: '2026-11-10',
      reconciled: true,
    }),
    directCostsWithClient: jest.fn().mockResolvedValue({
      fuel: 120000n,
      tolls: 24000n,
      repairs: 0n,
      driverIncentives: 7500n,
      otherExpenses: 0n,
      labour: 15000n,
      helperIncentives: 0n,
      writtenOff: 9999n,
    }),
    vehicleWindowWithClient: jest.fn().mockResolvedValue({ fixedCents: 900_000n, kmTenths: 15_000n }),
    stopLinesWithClient: jest.fn().mockResolvedValue([
      stopRow({ stop_id: 's1', customer_id: 'c1', key: 'l1', kg: '300.000', value: '15000.00' }),
      stopRow({ stop_id: 's2', customer_id: 'c2', key: 'l2', kg: '100.000', value: '5000.00' }),
    ]),
    firstServiceWithClient: jest.fn().mockResolvedValue(new Map()),
    kgSharePctWithClient: jest.fn().mockResolvedValue('50.00'),
    standardWithClient: jest.fn().mockResolvedValue(opts.standard ?? null),
    insertTripCostWithClient: jest.fn(async (_c: PoolClient, cost: Record<string, unknown>, rows: unknown[]) => {
      inserted.cost = cost;
      inserted.rows = rows;
    }),
  };
  const audit = { record: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  return { service: new CostingService(db as never, repo as never, audit as never), repo, inserted };
}

describe('allocateTripWithClient (C1–C5)', () => {
  it('pools the trip’s recorded costs and the vehicle’s share by km, and shares every rupee out', async () => {
    const { service, inserted } = build();
    await service.allocateTripWithClient(client, 'tenant-1', 'owner', 't1');
    const cost = inserted.cost as Record<string, unknown>;
    const pools = cost.pools as Record<string, bigint>;
    // 48.5 km × (₹9,000 ÷ 1,500 km) = ₹291.00
    expect(pools.vehicle).toBe(29_100n);
    expect(cost.tripKm).toBe('48.5');
    expect(cost.ratePerKm).toBe('6.0000');
    const total = Object.values(pools).reduce((s, v) => s + v, 0n);
    expect(cost.deliveryCost).toBe(total);
    expect(cost.unallocated).toBe(0n);
    expect(cost.deliveredKgMilli).toBe(400_000n);
    expect((inserted.rows as unknown[]).length).toBe(2);
  });

  it('holds the trip against the standard and records the variance', async () => {
    // Standard: ₹1,200 over 600 kg = ₹2/kg.
    const { service, inserted } = build({ standard: { basis: 'route', costCents: 120_000n, kgMilli: 600_000n, trips: 4 } });
    await service.allocateTripWithClient(client, 'tenant-1', 'owner', 't1');
    const cost = inserted.cost as Record<string, unknown>;
    // ₹1,200 + ₹240 + ₹75 + ₹150 + ₹99.99 + ₹291 = ₹2,055.99 over 400 kg = ₹5.1400/kg (5.139975 → 5.1400)
    expect(cost.actualPerKg).toBe('5.1400');
    expect([cost.standardPerKg, cost.standardBasis, cost.standardTrips]).toEqual(['2.0000', 'route', 4]);
    expect(cost.variancePerKg).toBe('3.1400');
  });

  it('a trip already costed is left alone', async () => {
    const { service, repo } = build({ hasCost: true });
    await service.allocateTripWithClient(client, 'tenant-1', 'owner', 't1');
    expect(repo.insertTripCostWithClient).not.toHaveBeenCalled();
  });
});

describe('toStops (C2)', () => {
  it('service minutes count only on deliveries, from phone stamps; history from the first verified visit', () => {
    const arrived = new Date('2026-11-10T09:00:00Z');
    const done = new Date('2026-11-10T09:25:00Z');
    const stops = toStops(
      [
        stopRow({ stop_id: 'a', customer_id: 'c1', key: 'a1', arrived_at: arrived, completed_at: done }),
        stopRow({ stop_id: 'f', stop_type: 'pickup', customer_id: null, key: 'lot1', arrived_at: arrived, completed_at: done }),
        stopRow({ stop_id: 'b', customer_id: 'c2', key: 'b1', kg: null }),
      ],
      (c) => c === 'c1',
    );
    expect(stops.map((s) => [s.stopId, s.serviceMinutes, s.customerHasHistory, s.lines[0].kind])).toEqual([
      ['a', 25, true, 'order_line'],
      ['f', null, false, 'lot'],
      ['b', null, false, 'order_line'],
    ]);
    expect(stops[2].lines[0].kgMilli).toBeNull();
  });
});

describe('contributionAt (C6: every level adds up to the business)', () => {
  const line = (over: Record<string, unknown>) => ({
    invoice_id: 'i1',
    invoice_line_id: 'il1',
    order_line_id: 'ol1',
    order_id: 'o1',
    order_number: 1,
    customer_id: 'c1',
    customer_name: 'Hotel',
    product_id: 'p1',
    product_name: 'Onion',
    route_id: 'r1',
    route_name: 'North',
    trip_id: 't1',
    trip_number: 'T-1',
    vehicle_id: 'v1',
    vehicle_registration: 'KL01',
    kg: '100.000',
    revenue: '5000.00',
    purchase: '2000.00',
    agent: '150.00',
    fuel: '300.00',
    tolls: '60.00',
    repairs: '0.00',
    driver_incentives: '20.00',
    other_expenses: '0.00',
    vehicle: '80.00',
    labour: '40.00',
    helper_incentives: '0.00',
    written_off: '25.00',
    ...over,
  });
  const lines = [
    line({}),
    line({ invoice_id: 'i1', invoice_line_id: 'il2', order_line_id: 'ol2', product_id: 'p2', product_name: 'Garlic', kg: '20.000', revenue: '3000.00', purchase: '1800.00', agent: '0.00' }),
    line({ invoice_id: 'i2', invoice_line_id: 'il3', order_line_id: 'ol3', order_id: 'o2', order_number: 2, customer_id: 'c2', customer_name: 'Shop', route_id: null, route_name: null, trip_id: null, trip_number: null, vehicle_id: null, vehicle_registration: null, fuel: '0.00', tolls: '0.00', vehicle: '0.00', labour: '0.00', written_off: '0.00', driver_incentives: '0.00' }),
  ];
  const extras = [
    { kind: 'unallocated' as const, trip_id: 't9', trip_number: 'T-9', vehicle_id: 'v1', vehicle_registration: 'KL01', route_id: 'r1', route_name: 'North', product_id: null, product_name: null, amount: '400.00', other_expenses: '400.00', written_off: '0.00', kg: '0.000' },
    { kind: 'inbound' as const, trip_id: 't1', trip_number: 'T-1', vehicle_id: 'v1', vehicle_registration: 'KL01', route_id: 'r1', route_name: 'North', product_id: 'p1', product_name: 'Onion', amount: '90.00', other_expenses: '90.00', written_off: '0.00', kg: '200.000' },
    { kind: 'store_write_off' as const, trip_id: null, trip_number: null, vehicle_id: null, vehicle_registration: null, route_id: null, route_name: null, product_id: 'p2', product_name: 'Garlic', amount: '35.00', other_expenses: '0.00', written_off: '35.00', kg: '0.000' },
  ];
  const finance = financeByLine(lines, new Map([['i1', 1001n], ['i2', 250n]]));

  it('spreads an invoice’s finance cost over its lines by revenue, to the paisa', () => {
    expect([finance.get('il1'), finance.get('il2'), finance.get('il3')]).toEqual([626n, 375n, 250n]);
  });

  it('every level’s rows add up to the same total — nothing lost, nothing counted twice', () => {
    const levels: ContributionLevel[] = ['business', 'route', 'trip', 'vehicle', 'product', 'customer', 'order'];
    const results = levels.map((l) => contributionAt(l, lines, extras, finance));
    const net = (rows: { netContribution: string }[]) => rows.reduce((s, r) => s + BigInt(r.netContribution.replace('.', '').replace('-', '')) * (r.netContribution.startsWith('-') ? -1n : 1n), 0n);
    for (const r of results) {
      expect(net(r.rows)).toBe(net([r.totals]));
      expect(r.totals).toEqual(results[0].totals);
    }
    // Revenue 5,000 + 3,000 + 5,000; finance ₹10.01 + ₹2.50.
    expect(results[0].totals).toMatchObject({ revenue: '13000.00', financeCost: '12.51' });
  });

  it('puts costs no line carries where they belong, and the rest in "not attributable"', () => {
    const product = contributionAt('product', lines, extras, finance);
    expect(product.rows.find((r) => r.key === 'p2')?.writtenOff).toBe('60.00'); // 25 on its line + 35 written off in the store
    const customer = contributionAt('customer', lines, extras, finance);
    expect(customer.rows.at(-1)).toMatchObject({ key: null, label: 'Not attributable at this level', other: '490.00', writtenOff: '35.00' });
    const trip = contributionAt('trip', lines, extras, finance);
    expect(trip.rows.find((r) => r.label === 'Not costed yet')?.revenue).toBe('5000.00');
  });
});
