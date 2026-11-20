import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OpeningBalancesService } from './opening-balances.service';
import { OpeningBalancesRepository } from './repositories/opening-balances.repository';
import { ReceivablesService } from './receivables.service';
import { PayablesService } from './payables.service';
import { DatabaseService } from '../../infra/database/database.service';

const fakeClient = {} as PoolClient;
const startOf = (day: string) => new Date(`${day}T00:00:00+05:30`);

// The client (20 Nov 2026): balances brought forward for old customers and farmers.
describe('OpeningBalancesService', () => {
  let service: OpeningBalancesService;
  let repo: { booksWithClient: jest.Mock; startOfDayWithClient: jest.Mock };
  let receivables: { issueOpeningBalanceWithClient: jest.Mock };
  let payables: { openingBalanceWithClient: jest.Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OpeningBalancesService,
        {
          provide: OpeningBalancesRepository,
          useValue: {
            booksWithClient: jest.fn().mockResolvedValue({ today: '2026-11-20', closedThrough: '2026-10-31' }),
            startOfDayWithClient: jest.fn(async (_c: unknown, day: string) => startOf(day)),
          },
        },
        {
          provide: ReceivablesService,
          useValue: {
            issueOpeningBalanceWithClient: jest.fn(async (_c: unknown, _t: string, _u: string, i: { amount: string; dueDate: string }) => ({
              invoiceId: 'inv-ob',
              invoiceNumber: 'OB-000001',
              amount: i.amount,
              dueDate: i.dueDate,
            })),
          },
        },
        {
          provide: PayablesService,
          useValue: {
            openingBalanceWithClient: jest.fn(async (_c: unknown, _t: string, _u: string, i: { amount: string }) => ({
              payableId: 'payable-ob',
              amount: i.amount,
              fromAdvance: '0.00',
              outstanding: i.amount,
            })),
          },
        },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
      ],
    }).compile();
    service = module.get(OpeningBalancesService);
    repo = module.get(OpeningBalancesRepository);
    receivables = module.get(ReceivablesService);
    payables = module.get(PayablesService);
  });

  it('stands at today and is due now unless the owner says — dated the start of that day, the amount to the paisa', async () => {
    const out = await service.forCustomer('tenant-1', 'user-1', 'cust-1', { amount: 12500.5, note: '  Old ledger, page 14 ' });
    expect(receivables.issueOpeningBalanceWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', {
      customerId: 'cust-1',
      amount: '12500.50',
      issuedAt: startOf('2026-11-20'),
      dueDate: '2026-11-20',
      note: 'Old ledger, page 14',
    });
    expect(out).toEqual({ kind: 'customer', customerId: 'cust-1', invoiceId: 'inv-ob', invoiceNumber: 'OB-000001', amount: '12500.50', dueDate: '2026-11-20', asOf: '2026-11-20' });
  });

  it('an earlier day in an open period, with its own due date', async () => {
    const out = await service.forFarmer('tenant-1', 'user-1', 'farmer-1', { amount: 8000, asOf: '2026-11-01', dueDate: '2026-11-15' });
    expect(payables.openingBalanceWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', {
      farmerId: 'farmer-1',
      amount: '8000.00',
      accruedAt: startOf('2026-11-01'),
      dueDate: '2026-11-15',
      note: null,
    });
    expect(out).toMatchObject({ kind: 'farmer', asOf: '2026-11-01', dueDate: '2026-11-15', outstanding: '8000.00' });
  });

  it('never a future day, a day the books are closed through, or a day that does not exist', async () => {
    await expect(service.forCustomer('tenant-1', 'user-1', 'cust-1', { amount: 1, asOf: '2026-11-21' })).rejects.toThrow(/not a future one/);
    await expect(service.forCustomer('tenant-1', 'user-1', 'cust-1', { amount: 1, asOf: '2026-10-31' })).rejects.toThrow(/closed through 2026-10-31/);
    await expect(service.forFarmer('tenant-1', 'user-1', 'farmer-1', { amount: 1, asOf: '2026-02-31' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.forFarmer('tenant-1', 'user-1', 'farmer-1', { amount: 1, dueDate: '2026-11-31' })).rejects.toBeInstanceOf(BadRequestException);
    expect(receivables.issueOpeningBalanceWithClient).not.toHaveBeenCalled();
    expect(payables.openingBalanceWithClient).not.toHaveBeenCalled();
  });

  it('with no period closed, any day up to today', async () => {
    repo.booksWithClient.mockResolvedValueOnce({ today: '2026-11-20', closedThrough: null });
    await service.forCustomer('tenant-1', 'user-1', 'cust-1', { amount: 100, asOf: '2025-04-01' });
    expect(receivables.issueOpeningBalanceWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', expect.objectContaining({ issuedAt: startOf('2025-04-01'), dueDate: '2025-04-01' }));
  });
});
