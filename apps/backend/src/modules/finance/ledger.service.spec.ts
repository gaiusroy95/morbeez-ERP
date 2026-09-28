import { PoolClient } from 'pg';
import { LedgerService } from './ledger.service';
import { LedgerRepository } from './repositories/ledger.repository';
import { multiplyToMoney } from '../../common/money';

const client = {} as PoolClient;
const at = new Date('2026-09-20T10:00:00Z');

describe('LedgerService', () => {
  let repo: { postWithClient: jest.Mock; postManualWithClient: jest.Mock };
  let service: LedgerService;

  beforeEach(() => {
    repo = { postWithClient: jest.fn().mockResolvedValue('entry-1'), postManualWithClient: jest.fn() };
    service = new LedgerService(repo as unknown as LedgerRepository);
  });

  const lines = () => repo.postWithClient.mock.calls[0][1].lines;

  it('a trip advance moves cash on hand to cash with drivers; no advance, no entry', async () => {
    await service.postTripAdvanceWithClient(client, 't', 'u', { id: 'trip-1', advanceAmount: '1000', occurredAt: at });
    expect(lines()).toEqual([
      { account: 'cash_with_drivers', debit: '1000.00' },
      { account: 'cash_on_hand', credit: '1000.00' },
    ]);

    repo.postWithClient.mockClear();
    await service.postTripAdvanceWithClient(client, 't', 'u', { id: 'trip-2', advanceAmount: '0.00', occurredAt: at });
    expect(repo.postWithClient).not.toHaveBeenCalled();
  });

  it('an expense draws the float down into its transport account', async () => {
    await service.postTripExpenseWithClient(client, 't', 'u', {
      id: 'e-1',
      tripId: 'trip-1',
      category: 'labour',
      amount: '250.5',
      notes: null,
      occurredAt: at,
    });
    expect(lines()).toEqual([
      { account: 'trip_expense_labour', debit: '250.50' },
      { account: 'cash_with_drivers', credit: '250.50' },
    ]);
  });

  const reconcile = (advanceAmount: string, totalExpenses: string, cashReturned: string) =>
    service.postTripReconciliationWithClient(client, 't', 'u', {
      id: 'r-1',
      tripId: 'trip-1',
      advanceAmount,
      totalExpenses,
      cashReturned,
      occurredAt: at,
    });

  it('reconciling a short trip books the gap as a cash shortage', async () => {
    await reconcile('1000.00', '400.00', '550.00');
    expect(lines()).toEqual([
      { account: 'cash_on_hand', debit: '550.00' },
      { account: 'cash_with_drivers', credit: '600.00' },
      { account: 'cash_shortage', debit: '50.00' },
    ]);
    expect(repo.postWithClient.mock.calls[0][1].memo).toMatch(/short 50\.00/);
  });

  it('reconciling with more cash than expected books the overage as income', async () => {
    await reconcile('1000.00', '400.00', '620.00');
    expect(lines()).toEqual([
      { account: 'cash_on_hand', debit: '620.00' },
      { account: 'cash_with_drivers', credit: '600.00' },
      { account: 'cash_over', credit: '20.00' },
    ]);
  });

  it('a driver who spent their own money leaves the float negative; reconciling clears it', async () => {
    await reconcile('100.00', '160.00', '0.00');
    expect(lines()).toEqual([
      { account: 'cash_on_hand', debit: '0.00' },
      { account: 'cash_with_drivers', debit: '60.00' },
      { account: 'cash_over', credit: '60.00' },
    ]);
  });

  it('a balanced reconciliation posts no shortage or overage line', async () => {
    await reconcile('1000.00', '400.00', '600.00');
    expect(lines()).toEqual([
      { account: 'cash_on_hand', debit: '600.00' },
      { account: 'cash_with_drivers', credit: '600.00' },
    ]);
  });

  it('a trip with no money at all posts nothing', async () => {
    await reconcile('0.00', '0.00', '0.00');
    expect(repo.postWithClient).not.toHaveBeenCalled();
  });

  it('a stock write-off goes to shrinkage, never COGS', async () => {
    await service.postInventoryWriteOffWithClient(client, 't', 'u', {
      movementId: 'm-1',
      lotId: 'lot-1',
      kind: 'rejected_post_acceptance',
      value: '213.50',
      reason: 'mould',
      occurredAt: at,
    });
    expect(lines()).toEqual([
      { account: 'shrinkage_expense', debit: '213.50' },
      { account: 'inventory_asset', credit: '213.50' },
    ]);
  });
});

describe('multiplyToMoney', () => {
  it.each([
    ['10.000', '21.35', '213.50'],
    ['0.125', '20.00', '2.50'], // 2.5 exactly
    ['0.333', '10.01', '3.33'], // 3.33333
    ['1.005', '1.00', '1.01'], // 1.005 → half-up
    ['2.5', '0.10', '0.25'],
    ['0', '99.99', '0.00'],
  ])('%s × %s = %s', (quantity, price, expected) => {
    expect(multiplyToMoney(quantity, price)).toBe(expected);
  });
});
