import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PayablesService } from './payables.service';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { PayablesRepository } from './repositories/payables.repository';
import { LedgerRepository } from './repositories/ledger.repository';
import { FarmersService } from '../farmers/farmers.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';

const fakeClient = {} as PoolClient;

describe('PayablesService', () => {
  let service: PayablesService;
  let taxRules: jest.Mocked<TaxRulesService>;
  let repo: jest.Mocked<PayablesRepository>;
  let ledger: jest.Mocked<LedgerRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PayablesService,
        {
          provide: PayablesRepository,
          useValue: {
            lockFarmerWithClient: jest.fn(),
            lotValueWithClient: jest.fn(),
            insertPayableWithClient: jest.fn().mockResolvedValue('payable-new'),
            openPayablesForFarmerWithClient: jest.fn().mockResolvedValue([]),
            unappliedPaymentsForFarmerWithClient: jest.fn().mockResolvedValue([]),
            insertPaymentWithClient: jest.fn().mockResolvedValue('fpay-1'),
            insertAllocationsWithClient: jest.fn(),
            findPaymentWithClient: jest.fn().mockResolvedValue({ id: 'fpay-1' }),
            listPaymentsWithClient: jest.fn(),
            lotStatusWithClient: jest.fn(),
            accruedThisYearWithClient: jest.fn().mockResolvedValue({ date: '2026-09-20', prior: '0.00' }),
          },
        },
        {
          provide: TaxRulesService,
          useValue: { assessFarmerTdsWithClient: jest.fn().mockResolvedValue(null), recordDeductionWithClient: jest.fn() },
        },
        { provide: LedgerRepository, useValue: { postWithClient: jest.fn() } },
        { provide: FarmersService, useValue: { getById: jest.fn().mockResolvedValue({ id: 'farmer-1', name: 'Ramesh' }) } },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(PayablesService);
    taxRules = module.get(TaxRulesService);
    repo = module.get(PayablesRepository);
    ledger = module.get(LedgerRepository);
  });

  const posting = () => ledger.postWithClient.mock.calls[0][1];
  const farmer = { type: 'farmer', id: 'farmer-1' };

  describe('accrueLotPayableWithClient', () => {
    const input = {
      lotId: 'lot-1',
      farmerId: 'farmer-1',
      acceptedQuantity: '95.000',
      unitCost: '20.00',
      gradedAt: new Date('2026-09-20T10:00:00Z'),
    };

    it('accrues the full cost to AP when there is no advance', async () => {
      repo.lotValueWithClient.mockResolvedValue('1900.00');

      const status = await service.accrueLotPayableWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(status).toEqual({ lotId: 'lot-1', payable: '1900.00', paid: '0.00', outstanding: '1900.00' });
      expect(posting()).toMatchObject({
        entryType: 'payable_accrued',
        lines: [
          { account: 'inventory_asset', debit: '1900.00' },
          { account: 'tds_payable', credit: '0.00' },
          { account: 'farmer_advance', party: farmer, credit: '0.00' },
          { account: 'accounts_payable_farmer', party: farmer, credit: '1900.00' },
        ],
      });
    });

    it('withholds TDS assessed on the lot: owed net, TDS payable to the government, deduction recorded', async () => {
      repo.lotValueWithClient.mockResolvedValue('1900.00');
      repo.accruedThisYearWithClient.mockResolvedValue({ date: '2026-09-20', prior: '4999000.00' });
      ledger.postWithClient.mockResolvedValue('entry-9');
      taxRules.assessFarmerTdsWithClient.mockResolvedValue({
        section: { id: 'sec-194q', code: '194Q' } as never,
        payeeName: 'Ramesh',
        deducteeType: 'individual_huf',
        pan: 'ABCPE1234F',
        rate: '0.100',
        baseAmount: '900.00',
        tdsAmount: '0.90',
      });

      const status = await service.accrueLotPayableWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(taxRules.assessFarmerTdsWithClient).toHaveBeenCalledWith(fakeClient, {
        farmerId: 'farmer-1',
        amount: '1900.00',
        date: '2026-09-20',
        priorThisYear: '4999000.00',
      });
      expect(posting().lines).toEqual([
        { account: 'inventory_asset', debit: '1900.00' },
        { account: 'tds_payable', credit: '0.90' },
        { account: 'farmer_advance', party: farmer, credit: '0.00' },
        { account: 'accounts_payable_farmer', party: farmer, credit: '1899.10' },
      ]);
      expect(taxRules.recordDeductionWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ sectionCode: '194Q', payableId: 'payable-new', tdsAmount: '0.90', baseAmount: '900.00', ledgerEntryId: 'entry-9' }),
      );
      expect(status).toEqual({ lotId: 'lot-1', payable: '1900.00', paid: '0.90', outstanding: '1899.10' });
    });

    it('draws advances down first, oldest first, and owes only the rest (ADV.2)', async () => {
      repo.lotValueWithClient.mockResolvedValue('1900.00');
      repo.unappliedPaymentsForFarmerWithClient.mockResolvedValue([
        { id: 'adv-1', unapplied: '500.00' },
        { id: 'adv-2', unapplied: '1000.00' },
      ]);

      const status = await service.accrueLotPayableWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'adv-1', payableId: 'payable-new', amount: '500.00' },
        { paymentId: 'adv-2', payableId: 'payable-new', amount: '1000.00' },
      ]);
      expect(status?.outstanding).toBe('400.00');
      expect(posting().lines).toEqual([
        { account: 'inventory_asset', debit: '1900.00' },
        { account: 'tds_payable', credit: '0.00' },
        { account: 'farmer_advance', party: farmer, credit: '1500.00' },
        { account: 'accounts_payable_farmer', party: farmer, credit: '400.00' },
      ]);
    });

    it('leaves an advance larger than the lot on account for the next lot (ADV.3)', async () => {
      repo.lotValueWithClient.mockResolvedValue('300.00');
      repo.unappliedPaymentsForFarmerWithClient.mockResolvedValue([{ id: 'adv-1', unapplied: '1000.00' }]);

      const status = await service.accrueLotPayableWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'adv-1', payableId: 'payable-new', amount: '300.00' },
      ]);
      expect(status?.outstanding).toBe('0.00');
    });

    it('accrues nothing for a lot worth nothing', async () => {
      repo.lotValueWithClient.mockResolvedValue('0.00');
      expect(await service.accrueLotPayableWithClient(fakeClient, 'tenant-1', 'user-1', input)).toBeNull();
      expect(repo.insertPayableWithClient).not.toHaveBeenCalled();
    });
  });

  describe('recordPayment', () => {
    const open = [
      { id: 'p-1', lotId: 'lot-1', outstanding: '1900.00' },
      { id: 'p-2', lotId: 'lot-2', outstanding: '600.00' },
    ];

    it('pays oldest lots first; the excess is an advance; the fee is a finance cost', async () => {
      repo.openPayablesForFarmerWithClient.mockResolvedValue(open);

      await service.recordPayment('tenant-1', 'user-1', {
        farmerId: 'farmer-1',
        amount: 3000,
        feeAmount: 5,
        method: 'bank_transfer',
        reference: 'NEFT-9',
      });

      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'fpay-1', payableId: 'p-1', amount: '1900.00' },
        { paymentId: 'fpay-1', payableId: 'p-2', amount: '600.00' },
      ]);
      expect(posting()).toMatchObject({
        entryType: 'farmer_payment_made',
        lines: [
          { account: 'accounts_payable_farmer', party: farmer, debit: '2500.00' },
          { account: 'farmer_advance', party: farmer, debit: '500.00' },
          { account: 'finance_costs', debit: '5.00' },
          { account: 'bank', credit: '3005.00' },
        ],
      });
    });

    it('tells listeners, after commit, which lots it paid off completely', async () => {
      repo.openPayablesForFarmerWithClient.mockResolvedValue(open);
      const listener = jest.fn().mockResolvedValue(undefined);
      service.onLotsPaid(listener);

      await service.recordPayment('tenant-1', 'user-1', { farmerId: 'farmer-1', amount: 2000, method: 'upi' });

      // lot-1 fully paid (1900), lot-2 only partly (100 of 600)
      expect(listener).toHaveBeenCalledWith('tenant-1', 'user-1', ['lot-1']);
    });

    it('a failing listener does not undo the payment', async () => {
      repo.openPayablesForFarmerWithClient.mockResolvedValue(open);
      service.onLotsPaid(jest.fn().mockRejectedValue(new Error('boom')));

      await expect(
        service.recordPayment('tenant-1', 'user-1', { farmerId: 'farmer-1', amount: 1900, method: 'cash' }),
      ).resolves.toEqual({ id: 'fpay-1' });
    });

    it('rejects paying a lot more than is owed on it', async () => {
      repo.openPayablesForFarmerWithClient.mockResolvedValue(open);
      await expect(
        service.recordPayment('tenant-1', 'user-1', {
          farmerId: 'farmer-1',
          amount: 700,
          method: 'upi',
          allocations: [{ lotId: 'lot-2', amount: 700 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
