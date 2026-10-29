import { ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { LotStockService } from './lot-stock.service';
import { BalanceRow, HeldRow, LotStockRepository } from './repositories/lot-stock.repository';

const client = {} as PoolClient;
const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T06:00:00Z`);

const balance = (id: string, over: Partial<BalanceRow> = {}): BalanceRow => ({
  id,
  lotId: `lot-${id}`,
  productId: 'p-tomato',
  locationId: null,
  vehicleId: null,
  quantity: '100.000',
  reserved: '0.000',
  unitCost: '10.00',
  receivedAt: at(1),
  ...over,
});

const held = (id: string, reserved: string, over: Partial<BalanceRow> = {}): HeldRow => ({
  ...balance(id, { reserved, ...over }),
  allocationId: `alloc-${id}`,
  allocationReserved: reserved,
  allocationDelivered: '0.000',
});

function setup() {
  const stock = {
    lockFreeWithClient: jest.fn().mockResolvedValue([]),
    heldForLineWithClient: jest.fn().mockResolvedValue([]),
    reserveWithClient: jest.fn().mockResolvedValue(true),
    releaseWithClient: jest.fn(),
    takeWithClient: jest.fn().mockResolvedValue(true),
    moveWithClient: jest.fn().mockResolvedValue('moved'),
    vehicleLocationWithClient: jest.fn().mockResolvedValue('loc-van'),
    insertMovementWithClient: jest.fn().mockResolvedValue({ id: 'mv-1', createdAt: at(28) }),
    onVehicleWithClient: jest.fn().mockResolvedValue([]),
    reservationsOnWithClient: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<LotStockRepository>;
  const audit = { record: jest.fn() };
  const ledger = { postInventoryWriteOffWithClient: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  const service = new LotStockService(db as never, stock, audit as never, ledger as never);
  return { service, stock, ledger };
}

describe('LotStockService', () => {
  it('reserves only the kilos an order needs, oldest first, and the rest is to come', async () => {
    const { service, stock } = setup();
    stock.lockFreeWithClient.mockResolvedValue([
      balance('a', { quantity: '40.000' }),
      balance('b', { quantity: '100.000', reserved: '90.000', receivedAt: at(2) }),
    ]);

    const out = await service.reserveForOrderLineWithClient(client, 't', 'u', { orderLineId: 'line-1', productId: 'p-tomato', quantity: '60.000' });

    expect(out).toEqual({ reserved: '50.000', toCome: '10.000' });
    expect(stock.lockFreeWithClient).toHaveBeenCalledWith(client, 'p-tomato', '60.000', null);
    expect(stock.reserveWithClient.mock.calls.map((c) => [c[2].id, c[4]])).toEqual([
      ['a', '40.000'],
      ['b', '10.000'],
    ]);
  });

  it("delivers the line's reserved kilos first, then free kilos on the vehicle, at those kilos' cost", async () => {
    const { service, stock } = setup();
    stock.heldForLineWithClient.mockResolvedValue([held('r', '100.000', { quantity: '100.000', unitCost: '8.00', vehicleId: 'van', locationId: 'loc-van' })]);
    stock.lockFreeWithClient.mockResolvedValue([balance('farm', { quantity: '985.000', unitCost: '10.00', vehicleId: 'van', locationId: 'loc-van' })]);

    const cost = await service.deliverForOrderLineWithClient(client, 't', 'u', {
      orderLineId: 'line-1',
      productId: 'p-tomato',
      label: 'Tomato',
      quantity: '350.000',
      vehicleId: 'van',
      tripId: 'trip-1',
    });

    // 100 × 8 + 250 × 10
    expect(cost).toBe('3300.00');
    expect(stock.takeWithClient.mock.calls.map((c) => [c[2].id, c[3]])).toEqual([
      ['r', { quantity: '100.000', fromReserved: '100.000', orderLineId: 'line-1', sold: true }],
      ['farm', { quantity: '250.000', fromReserved: '0', orderLineId: 'line-1', sold: true }],
    ]);
    expect(stock.lockFreeWithClient).toHaveBeenCalledWith(client, 'p-tomato', '250.000', 'van');
    expect(stock.insertMovementWithClient).toHaveBeenCalledTimes(2);
    expect(stock.insertMovementWithClient).toHaveBeenCalledWith(client, 't', 'u', expect.objectContaining({ type: 'delivered', tripId: 'trip-1', quantity: '250.000' }));
  });

  it('delivering less than was reserved lets the rest go', async () => {
    const { service, stock } = setup();
    stock.heldForLineWithClient.mockResolvedValue([held('r', '100.000')]);

    await service.deliverForOrderLineWithClient(client, 't', 'u', {
      orderLineId: 'line-1',
      productId: 'p-tomato',
      label: 'Tomato',
      quantity: '80.000',
      vehicleId: null,
      tripId: null,
    });

    expect(stock.releaseWithClient).toHaveBeenCalledWith(client, 'alloc-r', 'r', '20.000');
    expect(stock.lockFreeWithClient).not.toHaveBeenCalled();
  });

  it("refuses a delivery the vehicle doesn't hold", async () => {
    const { service, stock } = setup();
    stock.lockFreeWithClient.mockResolvedValue([balance('farm', { quantity: '50.000', vehicleId: 'van' })]);

    await expect(
      service.deliverForOrderLineWithClient(client, 't', 'u', {
        orderLineId: 'line-1',
        productId: 'p-tomato',
        label: 'Tomato',
        quantity: '80.000',
        vehicleId: 'van',
        tripId: 'trip-1',
      }),
    ).rejects.toThrow(new ConflictException('Not enough Tomato on the vehicle to deliver 80: 30 short — record the farm pickup or the stock first'));
  });

  it("loads the reserved kilos still in the store onto the trip's vehicle", async () => {
    const { service, stock } = setup();
    stock.heldForLineWithClient
      .mockResolvedValueOnce([held('store', '60.000', { quantity: '100.000' }), held('already', '10.000', { vehicleId: 'van', locationId: 'loc-van' })])
      .mockResolvedValueOnce([]);

    await service.loadOrderLinesWithClient(client, 't', 'u', { id: 'trip-1', vehicleId: 'van' }, ['line-2', 'line-1']);

    expect(stock.vehicleLocationWithClient).toHaveBeenCalledWith(client, 't', 'u', 'van');
    expect(stock.moveWithClient).toHaveBeenCalledTimes(1);
    expect(stock.moveWithClient).toHaveBeenCalledWith(client, 't', expect.objectContaining({ id: 'store' }), '60.000', 'loc-van', {
      allocationId: 'alloc-store',
      orderLineId: 'line-1',
      reserved: '60.000',
    });
    expect(stock.insertMovementWithClient).toHaveBeenCalledWith(
      client,
      't',
      'u',
      expect.objectContaining({ type: 'loaded', quantity: '60.000', toLocationId: 'loc-van', tripId: 'trip-1' }),
    );
  });

  it('at closing, writes off what the count is short (free kilos first) and returns the rest to the store', async () => {
    const { service, stock, ledger } = setup();
    const onVan = [
      balance('old', { quantity: '30.000', reserved: '20.000', unitCost: '8.00', vehicleId: 'van', locationId: 'loc-van' }),
      balance('new', { quantity: '355.000', unitCost: '10.00', vehicleId: 'van', locationId: 'loc-van', receivedAt: at(28) }),
    ];
    stock.onVehicleWithClient.mockResolvedValue(onVan);

    const out = await service.returnFromVehicleWithClient(client, 't', 'u', { id: 'trip-1', vehicleId: 'van' }, new Map([['p-tomato', '370.000']]), 'Spoiled');

    // 385 on the van, 370 counted: 15 missing — the 10 free kilos of the old lot, then 5 of the new one.
    expect(stock.takeWithClient.mock.calls.map((c) => [c[2].id, c[3].quantity, c[3].sold])).toEqual([
      ['old', '10.000', false],
      ['new', '5.000', false],
    ]);
    expect(ledger.postInventoryWriteOffWithClient.mock.calls.map((c) => c[3].value)).toEqual(['80.00', '50.00']);
    expect(stock.moveWithClient.mock.calls.map((c) => [c[2].id, c[3], c[4]])).toEqual([
      ['old', '20.000', null],
      ['new', '350.000', null],
    ]);
    expect(out).toEqual([
      { productId: 'p-tomato', onVehicle: '385.000', counted: '370.000', writtenOff: '15.000', writtenOffValue: '130.00', returned: '370.000' },
    ]);
  });

  it('at closing, lets go of reservations only when the free kilos do not cover what is missing', async () => {
    const { service, stock } = setup();
    stock.onVehicleWithClient.mockResolvedValue([balance('held', { quantity: '50.000', reserved: '50.000', vehicleId: 'van', locationId: 'loc-van' })]);
    stock.reservationsOnWithClient.mockResolvedValue([{ id: 'alloc-1', reserved: '50.000' }]);

    await service.returnFromVehicleWithClient(client, 't', 'u', { id: 'trip-1', vehicleId: 'van' }, new Map([['p-tomato', '45.000']]), null);

    expect(stock.releaseWithClient).toHaveBeenCalledWith(client, 'alloc-1', 'held', '5.000');
    expect(stock.takeWithClient).toHaveBeenCalledWith(client, 't', expect.objectContaining({ id: 'held' }), expect.objectContaining({ quantity: '5.000', fromReserved: '0' }));
    expect(stock.moveWithClient).toHaveBeenCalledWith(client, 't', expect.objectContaining({ id: 'held', quantity: '45.000' }), '45.000', null, null);
  });

  it('a trip setting off with stock still aboard takes it on, where it stands', async () => {
    const { service, stock } = setup();
    stock.onVehicleWithClient.mockResolvedValue([balance('left', { quantity: '20.000', vehicleId: 'van', locationId: 'loc-van' })]);

    const carried = await service.carryOverWithClient(client, 't', 'u', { id: 'trip-2', vehicleId: 'van' });

    expect(carried).toBe('20.000');
    expect(stock.moveWithClient).not.toHaveBeenCalled();
    expect(stock.insertMovementWithClient).toHaveBeenCalledWith(
      client,
      't',
      'u',
      expect.objectContaining({ type: 'loaded', quantity: '20.000', fromLocationId: 'loc-van', toLocationId: 'loc-van', tripId: 'trip-2' }),
    );
  });

  it('with no count, everything on the vehicle comes back as the books have it', async () => {
    const { service, stock, ledger } = setup();
    stock.onVehicleWithClient.mockResolvedValue([balance('a', { quantity: '12.000', vehicleId: 'van', locationId: 'loc-van' })]);

    const out = await service.returnFromVehicleWithClient(client, 't', 'u', { id: 'trip-1', vehicleId: 'van' }, null, null);

    expect(stock.takeWithClient).not.toHaveBeenCalled();
    expect(ledger.postInventoryWriteOffWithClient).not.toHaveBeenCalled();
    expect(out[0]).toEqual(expect.objectContaining({ counted: null, writtenOff: '0.000', returned: '12.000' }));
  });
});
