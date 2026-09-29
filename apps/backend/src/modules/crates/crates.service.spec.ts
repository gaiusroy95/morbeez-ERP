import { PoolClient } from 'pg';
import { CratesService } from './crates.service';
import { CratesRepository } from './repositories/crates.repository';

const client = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }) } as unknown as PoolClient;
const books = { today: '2026-09-29', timezone: 'Asia/Kolkata', currency: 'INR' };
const PL20 = { id: 't1', code: 'PL20', name: 'Plastic 20 kg', capacityKg: '20.00', replacementCost: '180.00', hsnCode: '3923', reorderLevel: 50, isActive: true, version: 1 };

function setup(overrides: Partial<Record<keyof CratesRepository, jest.Mock>> = {}) {
  let n = 0;
  const repo = {
    books: jest.fn().mockResolvedValue(books),
    instant: jest.fn().mockResolvedValue(new Date('2026-09-20T06:30:00Z')),
    lock: jest.fn(),
    settings: jest.fn().mockResolvedValue({ customerOverdueDays: 7, farmerOverdueDays: 15, version: 0 }),
    holderName: jest.fn().mockResolvedValue('Hotel Sagar'),
    findType: jest.fn().mockResolvedValue(PL20),
    types: jest.fn().mockResolvedValue([PL20]),
    insertMovement: jest.fn().mockImplementation(async () => `m${++n}`),
    balanceOf: jest.fn().mockResolvedValue(10),
    movements: jest.fn().mockResolvedValue([]),
    insertLoss: jest.fn().mockResolvedValue('loss-1'),
    insertDeductions: jest.fn(),
    losses: jest.fn().mockResolvedValue([{ id: 'loss-1' }]),
    trip: jest.fn(),
    tripStops: jest.fn(),
    balances: jest.fn().mockResolvedValue([]),
    limits: jest.fn().mockResolvedValue(new Map()),
    partyEvents: jest.fn().mockResolvedValue([]),
    vehiclesOnTrip: jest.fn().mockResolvedValue(new Set()),
    ...overrides,
  } as unknown as jest.Mocked<CratesRepository>;
  const ledger = { postSystemWithClient: jest.fn().mockResolvedValue('entry-1') };
  const receivables = { issueCrateChargeWithClient: jest.fn().mockResolvedValue({ invoiceId: 'inv-1', invoiceNumber: 'CRT-000001', amount: '1062.00', taxAmount: '162.00', entryId: 'e-1' }) };
  const payables = {
    deductWithClient: jest.fn().mockResolvedValue({ entryId: 'e-2', deductions: [{ payableId: 'p1', amount: '360.00' }], fullyPaidLots: ['lot-1'] }),
    announceLotsPaid: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  const service = new CratesService(db as never, repo, ledger as never, receivables as never, payables as never, audit as never);
  return { service, repo, ledger, receivables, payables };
}

describe('CratesService', () => {
  describe('recordMovement', () => {
    it('issues from the yard to a customer', async () => {
      const { service, repo } = setup();
      await service.recordMovement('t', 'u', { kind: 'issued', partyKind: 'customer', partyId: 'c1', lines: [{ crateTypeId: 't1', quantity: 5 }] });
      expect(repo.insertMovement).toHaveBeenCalledWith(client, expect.objectContaining({ kind: 'issued', fromKind: 'yard', fromId: null, toKind: 'customer', toId: 'c1', quantity: 5 }));
      expect(repo.balanceOf).toHaveBeenCalledWith(client, 'yard', null, 't1');
    });

    it('refuses to take a holder below zero, and says what it holds', async () => {
      const { service } = setup({ balanceOf: jest.fn().mockResolvedValue(-3) });
      await expect(
        service.recordMovement('t', 'u', { kind: 'returned', partyKind: 'customer', partyId: 'c1', lines: [{ crateTypeId: 't1', quantity: 8 }] }),
      ).rejects.toThrow(/Hotel Sagar holds only 5 PL20 crates, not 8 — .*opening balance/);
    });

    it('a trip decides the vehicle', async () => {
      const { service, repo } = setup({ trip: jest.fn().mockResolvedValue({ id: 'trip-1', vehicle_id: 'v9', status: 'in_progress' }) });
      await service.recordMovement('t', 'u', { kind: 'loaded', tripId: 'trip-1', lines: [{ crateTypeId: 't1', quantity: 40 }] });
      expect(repo.insertMovement).toHaveBeenCalledWith(client, expect.objectContaining({ fromKind: 'yard', toKind: 'vehicle', toId: 'v9', tripId: 'trip-1' }));
    });

    it('a purchase with a cost is expensed; nothing else carries a cost', async () => {
      const { service, ledger } = setup();
      await service.recordMovement('t', 'u', { kind: 'purchased', lines: [{ crateTypeId: 't1', quantity: 100 }], cost: 16000, paidFrom: 'bank' });
      expect(ledger.postSystemWithClient.mock.calls[0][1].lines).toEqual([
        { account: 'crate_purchases', debit: '16000.00' },
        { account: 'bank', credit: '16000.00' },
      ]);
      await expect(service.recordMovement('t', 'u', { kind: 'issued', partyKind: 'farmer', partyId: 'f1', lines: [{ crateTypeId: 't1', quantity: 1 }], cost: 1, paidFrom: 'bank' })).rejects.toThrow(/Only a purchase/);
    });

    it('each crate type once per entry', async () => {
      const { service } = setup();
      await expect(
        service.recordMovement('t', 'u', { kind: 'purchased', lines: [{ crateTypeId: 't1', quantity: 1 }, { crateTypeId: 't1', quantity: 2 }] }),
      ).rejects.toThrow(/once per entry/);
    });
  });

  describe('recordLoss', () => {
    const base = { holderKind: 'customer' as const, holderId: 'c1', crateTypeId: 't1', quantity: 5, reason: 'Not returned after 30 days' };

    it('a customer is invoiced at replacement cost, on the crate type\'s HSN', async () => {
      const { service, receivables, repo } = setup();
      await service.recordLoss('t', 'u', { ...base, recovery: 'charge' }, 'charge');
      expect(receivables.issueCrateChargeWithClient).toHaveBeenCalledWith(client, 't', 'u', expect.objectContaining({ customerId: 'c1', quantity: '5', unitPrice: '180.00', hsnCode: '3923' }));
      expect(repo.insertLoss).toHaveBeenCalledWith(client, expect.objectContaining({ recovery: 'invoiced', amount: '1062.00', taxAmount: '162.00', invoiceId: 'inv-1' }));
    });

    it('a farmer has it deducted from what they are owed; lots it settles are announced after commit', async () => {
      const { service, payables, repo } = setup();
      await service.recordLoss('t', 'u', { ...base, holderKind: 'farmer', holderId: 'f1', quantity: 2, recovery: 'charge' }, 'charge');
      expect(payables.deductWithClient).toHaveBeenCalledWith(client, 't', 'u', expect.objectContaining({ farmerId: 'f1', amount: '360.00', sourceType: 'crate_loss' }));
      expect(repo.insertDeductions).toHaveBeenCalledWith(client, 't', 'loss-1', [{ payableId: 'p1', amount: '360.00' }]);
      expect(payables.announceLotsPaid).toHaveBeenCalledWith('t', 'u', ['lot-1']);
    });

    it('charging goes through its own route, and only a customer or farmer can be charged', async () => {
      const { service } = setup();
      await expect(service.recordLoss('t', 'u', { ...base, recovery: 'charge' }, 'absorbed')).rejects.toThrow(/losses\/charge/);
      await expect(service.recordLoss('t', 'u', { ...base, holderKind: 'vehicle', holderId: 'v1', recovery: 'charge' }, 'charge')).rejects.toThrow(/Only a customer or farmer/);
    });

    it('absorbed: written off, nothing posted', async () => {
      const { service, receivables, payables, repo } = setup();
      await service.recordLoss('t', 'u', { ...base, holderKind: 'yard', holderId: undefined, recovery: 'absorbed', reason: 'Broken in the yard' }, 'absorbed');
      expect(repo.insertMovement).toHaveBeenCalledWith(client, expect.objectContaining({ kind: 'lost', fromKind: 'yard', toKind: 'lost' }));
      expect(repo.insertLoss).toHaveBeenCalledWith(client, expect.objectContaining({ recovery: 'absorbed', amount: '0.00' }));
      expect(receivables.issueCrateChargeWithClient).not.toHaveBeenCalled();
      expect(payables.deductWithClient).not.toHaveBeenCalled();
    });
  });

  describe('alerts', () => {
    it('overdue, over the limit, left on an idle vehicle, and low in the yard', async () => {
      const { service } = setup({
        balances: jest.fn().mockResolvedValue([
          { holder_kind: 'customer', holder_id: 'c1', holder_name: 'Hotel Sagar', crate_type_id: 't1', code: 'PL20', replacement_cost: '180.00', balance: 30, last_movement_at: null },
          { holder_kind: 'vehicle', holder_id: 'v1', holder_name: 'MH12AB4521', crate_type_id: 't1', code: 'PL20', replacement_cost: '180.00', balance: 4, last_movement_at: null },
          { holder_kind: 'yard', holder_id: null, holder_name: null, crate_type_id: 't1', code: 'PL20', replacement_cost: '180.00', balance: 20, last_movement_at: null },
        ]),
        partyEvents: jest.fn().mockResolvedValue([{ holder_kind: 'customer', holder_id: 'c1', crate_type_id: 't1', on: '2026-09-19', delta: 30 }]),
        limits: jest.fn().mockResolvedValue(new Map([['customer:c1', 25]])),
      });
      const alerts = await service.alerts('t');
      expect(alerts.map((a) => `${a.kind}:${a.severity}`)).toEqual(['over_limit:bad', 'overdue:attention', 'yard_low:attention', 'vehicle_idle:attention']);
      expect(alerts.find((a) => a.kind === 'overdue')!.message).toMatch(/oldest out 10 days \(allowed 7\)/);
    });
  });

  describe('recordStopCounts', () => {
    it('collections first, then drops, both against the stop\'s party and the trip\'s vehicle', async () => {
      const { service, repo } = setup({
        trip: jest.fn().mockResolvedValue({ id: 'trip-1', vehicle_id: 'v1', status: 'in_progress', registration_number: 'MH12AB4521' }),
        tripStops: jest.fn().mockResolvedValue([{ id: 's1', sequence_number: 1, stop_type: 'delivery', party_kind: 'customer', party_id: 'c1', party_name: 'Hotel Sagar' }]),
      });
      await service.recordStopCounts('t', 'u', 'trip-1', 's1', { lines: [{ crateTypeId: 't1', dropped: 12, collected: 7 }] });
      const kinds = repo.insertMovement.mock.calls.map((c) => `${c[1].kind}:${c[1].fromKind}>${c[1].toKind}:${c[1].quantity}`);
      expect(kinds).toEqual(['collected:customer>vehicle:7', 'delivered:vehicle>customer:12']);
    });
  });
});
