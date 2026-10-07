import { PoolClient } from 'pg';
import { SpotSalesService } from './spot-sales.service';
import { SpotSalesRepository } from './repositories/spot-sales.repository';

const client = {} as PoolClient;
const driver = { tenantId: 't', userId: 'u-driver', permissions: ['spot_sales:record'] };
const trip = { id: 'trip-1', status: 'in_progress', vehicle_id: 'v1', driver_employee_id: 'emp-1', registration_number: 'MH12AB4521' };
const lots = [
  { lot_id: 'lot-a', product_id: 'p1', quantity: '30.000', unit_cost: '20.00', received_at: '2026-09-20', location_id: 'loc-v', version: 1 },
  { lot_id: 'lot-b', product_id: 'p1', quantity: '20.000', unit_cost: '24.00', received_at: '2026-09-25', location_id: 'loc-v', version: 1 },
];

function setup(overrides: Partial<Record<keyof SpotSalesRepository, jest.Mock>> = {}) {
  let header: Record<string, unknown> | null = null;
  const repo = {
    findByClientRef: jest.fn().mockResolvedValue(null),
    trip: jest.fn().mockResolvedValue(trip),
    lockVehicle: jest.fn(),
    books: jest.fn().mockResolvedValue({ today: '2026-09-29', timezone: 'Asia/Kolkata', currency: 'INR' }),
    products: jest.fn().mockResolvedValue(new Map([['p1', { name: 'Tomato', uom: 'kg', basePrice: '32.00', status: 'active' }]])),
    bandsInForce: jest.fn().mockResolvedValue(new Map([['p1', { minPrice: '28.00', maxPrice: '40.00' }]])),
    settings: jest.fn().mockResolvedValue({ defaultFloorPct: '10.00', defaultCeilingPct: '25.00', version: 0 }),
    vehicleLots: jest.fn().mockResolvedValue(lots),
    held: jest.fn().mockResolvedValue(new Map()),
    nextSaleNumber: jest.fn().mockResolvedValue('SS-000001'),
    insertSale: jest.fn().mockImplementation(async (_c, s) => {
      header = { id: s.id, sale_number: s.saleNumber, trip_id: s.tripId, vehicle_id: s.vehicleId, driver_employee_id: s.driverEmployeeId, buyer_name: s.buyerName, payment_method: s.paymentMethod, payment_reference: s.paymentReference, status: s.status, approval_request_id: s.approvalRequestId, sold_at: s.soldAt, created_by: s.userId, version: 1 };
    }),
    insertLine: jest.fn().mockResolvedValue('line-1'),
    header: jest.fn().mockImplementation(async () => header),
    lines: jest.fn().mockImplementation(async (_c, ids) => new Map([[ids[0], [{ id: 'line-1', productId: 'p1', productName: 'Tomato', quantity: '40.000', unitPrice: '30.00' }]]])),
    drawLot: jest.fn().mockResolvedValue(true),
    insertLineLot: jest.fn(),
    insertStockMovement: jest.fn(),
    complete: jest.fn(),
    find: jest.fn().mockResolvedValue({ id: 's1', driverEmployeeId: 'emp-1', costTotal: '600.00', margin: '300.00', lines: [{ unitCostEstimate: '20.00', lots: [{ lotId: 'l1', quantity: '30', unitCost: '20.00' }] }] }),
    ...overrides,
  } as unknown as jest.Mocked<SpotSalesRepository>;
  const approvals = { requireWithClient: jest.fn().mockResolvedValue({ id: 'req-1' }), getRequest: jest.fn(), decide: jest.fn(), cancel: jest.fn() };
  const workforce = { getEmployeeIdForUser: jest.fn().mockResolvedValue('emp-1') };
  const ledger = { postSystemWithClient: jest.fn().mockResolvedValue('e1') };
  const receivables = { issueSpotSaleWithClient: jest.fn().mockResolvedValue({ invoiceId: 'inv-1', invoiceNumber: 'SPT-000001', taxableValue: '1200.00', total: '1200.00', paymentId: 'pay-1' }) };
  const audit = { record: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  const service = new SpotSalesService(db as never, repo, approvals as never, workforce as never, ledger as never, receivables as never, audit as never, { assertCan: jest.fn() } as never);
  return { service, repo, approvals, workforce, ledger, receivables };
}

const sale = (price: number, quantity = 40) => ({ clientRef: '00000000-0000-4000-8000-000000000001', tripId: 'trip-1', paymentMethod: 'cash' as const, lines: [{ productId: 'p1', quantity, unitPrice: price }] });

describe('SpotSalesService.record', () => {
  it('inside the band: completes at once — oldest lots first, COGS at their cost, invoiced and paid', async () => {
    const { service, repo, ledger, receivables, approvals } = setup();
    await service.record(driver, sale(30));
    expect(approvals.requireWithClient).not.toHaveBeenCalled();
    expect(repo.drawLot.mock.calls.map((c) => [c[1], c[2]])).toEqual([['lot-a', '30.000'], ['lot-b', '10.000']]);
    expect(repo.insertStockMovement).toHaveBeenCalledTimes(2);
    // 30 × 20 + 10 × 24
    expect(ledger.postSystemWithClient.mock.calls[0][1]).toMatchObject({ entryType: 'cogs_recognized', lines: [{ account: 'cost_of_goods_sold', debit: '840.00' }, { account: 'inventory_asset', credit: '840.00' }] });
    expect(receivables.issueSpotSaleWithClient).toHaveBeenCalledWith(client, 't', 'u-driver', expect.objectContaining({ method: 'cash', saleNumber: 'SS-000001' }));
    expect(repo.complete).toHaveBeenCalledWith(client, expect.any(String), expect.objectContaining({ costTotal: '840.00', total: '1200.00' }));
  });

  it('under the floor: files an approval sized by the shortfall and holds the stock, nothing posted', async () => {
    const { service, approvals, repo, ledger } = setup();
    await service.record(driver, sale(25));
    // (28 − 25) × 40
    expect(approvals.requireWithClient).toHaveBeenCalledWith(client, 't', 'u-driver', expect.objectContaining({ actionType: 'spot_sale_price', amount: 120 }));
    expect(repo.insertSale).toHaveBeenCalledWith(client, expect.objectContaining({ status: 'pending_approval', exceptionValue: '120.00', approvalRequestId: 'req-1' }));
    expect(repo.insertLine).toHaveBeenCalledWith(client, expect.objectContaining({ exception: 'below_band', bandSource: 'band', unitCostEstimate: '21.00' }));
    expect(repo.drawLot).not.toHaveBeenCalled();
    expect(ledger.postSystemWithClient).not.toHaveBeenCalled();
  });

  it('refuses more than the vehicle has free after what pending sales hold', async () => {
    const { service } = setup({ held: jest.fn().mockResolvedValue(new Map([['p1', '15.000']])) });
    await expect(service.record(driver, sale(30, 40))).rejects.toThrow(/only 35.000 kg of Tomato free/);
  });

  it('the driver gets the sale back without what the stock cost or the margin (Security Audit SA-05)', async () => {
    const { service } = setup();
    const back = await service.record(driver, sale(30));
    expect(back.costTotal).toBeNull();
    expect(back.margin).toBeNull();
    expect(back.lines[0].unitCostEstimate).toBeNull();
    expect(back.lines[0].lots).toEqual([]);
  });

  it("a driver can't sell from someone else's trip", async () => {
    const { service, workforce } = setup();
    workforce.getEmployeeIdForUser.mockResolvedValue('emp-2');
    await expect(service.record(driver, sale(30))).rejects.toThrow(/your own trip/);
  });

  it('a replayed clientRef returns the sale already recorded', async () => {
    const { service, repo } = setup({ findByClientRef: jest.fn().mockResolvedValue({ id: 's1', trip_id: 'trip-1' }) });
    await service.record(driver, sale(30));
    expect(repo.insertSale).not.toHaveBeenCalled();
    expect(repo.find).toHaveBeenCalledWith(client, 's1');
  });

  it('only on a trip on the road', async () => {
    const { service } = setup({ trip: jest.fn().mockResolvedValue({ ...trip, status: 'completed' }) });
    await expect(service.record(driver, sale(30))).rejects.toThrow(/on the road/);
  });
});
