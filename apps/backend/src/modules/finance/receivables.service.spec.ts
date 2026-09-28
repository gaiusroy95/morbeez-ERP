import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ReceivablesService } from './receivables.service';
import { TaxRulesService } from '../tax-rules/tax-rules.service';
import { InvoiceTax } from '../tax-rules/entities/tax-rules.entity';
import { ReceivablesRepository } from './repositories/receivables.repository';
import { LedgerRepository } from './repositories/ledger.repository';
import { CustomersService } from '../customers/customers.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CustomerRecord } from '../customers/entities/customer.entity';

const fakeClient = {} as PoolClient;

const customer: CustomerRecord = {
  id: 'cust-1',
  tenantId: 'tenant-1',
  name: 'Hotel Sagar',
  contact: {},
  creditLimit: '50000.00',
  paymentTermsDays: 7,
  financeChargeRateMonthly: '2.00',
  financeChargeGraceDays: 5,
  creditHold: false,
  creditHoldReason: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

function untaxed(amounts: string[]): InvoiceTax {
  const cents = amounts.reduce((t, a) => t + Math.round(Number(a) * 100), 0);
  const total = (cents / 100).toFixed(2);
  return {
    documentType: 'invoice',
    registrationType: 'unregistered',
    supplierGstin: null,
    supplierState: null,
    buyerGstin: null,
    buyerLegalName: null,
    buyerAddressLine1: null,
    buyerCity: null,
    buyerPincode: null,
    placeOfSupply: null,
    intraState: true,
    lines: [],
    taxableValue: total,
    cgst: '0.00',
    sgst: '0.00',
    igst: '0.00',
    cess: '0.00',
    total,
  };
}

describe('ReceivablesService', () => {
  let service: ReceivablesService;
  let taxRules: jest.Mocked<TaxRulesService>;
  let repo: jest.Mocked<ReceivablesRepository>;
  let ledger: jest.Mocked<LedgerRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReceivablesService,
        {
          provide: ReceivablesRepository,
          useValue: {
            lockCustomerWithClient: jest.fn(),
            todayWithClient: jest.fn().mockResolvedValue('2026-09-26'),
            nextInvoiceNumberWithClient: jest.fn().mockResolvedValue('INV-000042'),
            priceLinesWithClient: jest.fn(),
            insertInvoiceWithClient: jest.fn().mockResolvedValue({ invoiceId: 'inv-new', lineIds: ['line-1'] }),
            findInvoiceWithClient: jest.fn().mockResolvedValue({ id: 'inv-new' }),
            findInvoiceByOrderWithClient: jest.fn().mockResolvedValue(null),
            openInvoicesForCustomerWithClient: jest.fn().mockResolvedValue([]),
            unappliedPaymentsForCustomerWithClient: jest.fn().mockResolvedValue([]),
            insertPaymentWithClient: jest.fn().mockResolvedValue('pay-1'),
            insertAllocationsWithClient: jest.fn(),
            insertReversalWithClient: jest.fn(),
            findPaymentWithClient: jest.fn().mockResolvedValue({ id: 'pay-1', customerId: 'cust-1', customerName: 'Hotel Sagar', reversedAt: null }),
            customerBalanceWithClient: jest.fn(),
            financeChargeCandidatesWithClient: jest.fn().mockResolvedValue([]),
            insertFinanceChargeWithClient: jest.fn().mockResolvedValue('fc-1'),
            findChargesWithClient: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: LedgerRepository, useValue: { postWithClient: jest.fn().mockResolvedValue('entry-1'), findEntryWithClient: jest.fn() } },
        { provide: CustomersService, useValue: { getByIdWithClient: jest.fn().mockResolvedValue(customer) } },
        { provide: DatabaseService, useValue: { withTenant: jest.fn((_t, work) => work(fakeClient)) } },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: TaxRulesService,
          useValue: {
            // Untaxed by default: an unregistered business's plain invoice.
            computeInvoiceTaxWithClient: jest.fn(async (_c: unknown, input: { lines: { taxableValue: string }[] }) =>
              untaxed(input.lines.map((l) => l.taxableValue)),
            ),
            recordInvoiceTaxWithClient: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ReceivablesService);
    taxRules = module.get(TaxRulesService);
    repo = module.get(ReceivablesRepository);
    ledger = module.get(LedgerRepository);
  });

  const postings = () => ledger.postWithClient.mock.calls.map((c) => c[1]);

  describe('issueSaleInvoiceWithClient', () => {
    const input = {
      orderId: 'order-1',
      customerId: 'cust-1',
      deliveredAt: new Date('2026-09-26T08:00:00Z'),
      lines: [{ orderLineId: 'l1', productId: 'p1', description: 'Tomato', quantity: '80.000', unitPrice: '35.00' }],
      costOfGoods: '1760.00',
    };

    it('posts the invoice (Dr AR / Cr Revenue) and cost of goods (Dr COGS / Cr Inventory), due per terms', async () => {
      repo.priceLinesWithClient.mockResolvedValue({ amounts: ['2800.00'], total: '2800.00' });

      await service.issueSaleInvoiceWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(repo.insertInvoiceWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ kind: 'sale', invoiceNumber: 'INV-000042', dueDate: '2026-10-03', amount: '2800.00' }),
      );
      const [cogs, invoice] = postings();
      expect(cogs).toMatchObject({
        entryType: 'cogs_recognized',
        sourceId: 'order-1',
        lines: [
          { account: 'cost_of_goods_sold', debit: '1760.00' },
          { account: 'inventory_asset', credit: '1760.00' },
        ],
      });
      expect(invoice).toMatchObject({
        entryType: 'invoice_issued',
        sourceId: 'inv-new',
        lines: [
          { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, debit: '2800.00' },
          { account: 'revenue_sales', credit: '2800.00' },
          { account: 'output_cgst', credit: '0.00' },
          { account: 'output_sgst', credit: '0.00' },
          { account: 'output_igst', credit: '0.00' },
          { account: 'output_cess', credit: '0.00' },
        ],
      });
      expect(taxRules.recordInvoiceTaxWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'inv-new', ['line-1'], expect.anything());
    });

    it('bills goods plus GST: the customer owes the total, output GST is a liability, revenue is the taxable value', async () => {
      repo.priceLinesWithClient.mockResolvedValue({ amounts: ['2800.00'], total: '2800.00' });
      taxRules.computeInvoiceTaxWithClient.mockResolvedValueOnce({
        ...untaxed(['2800.00']),
        documentType: 'tax_invoice',
        registrationType: 'regular',
        cgst: '70.00',
        sgst: '70.00',
        total: '2940.00',
      });

      await service.issueSaleInvoiceWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(repo.insertInvoiceWithClient).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ amount: '2940.00' }));
      expect(postings()[1].lines).toEqual([
        { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, debit: '2940.00' },
        { account: 'revenue_sales', credit: '2800.00' },
        { account: 'output_cgst', credit: '70.00' },
        { account: 'output_sgst', credit: '70.00' },
        { account: 'output_igst', credit: '0.00' },
        { account: 'output_cess', credit: '0.00' },
      ]);
    });

    it('applies credit the customer already paid in to the new invoice', async () => {
      repo.priceLinesWithClient.mockResolvedValue({ amounts: ['2800.00'], total: '2800.00' });
      repo.unappliedPaymentsForCustomerWithClient.mockResolvedValue([{ id: 'pay-early', unapplied: '1000.00' }]);
      repo.openInvoicesForCustomerWithClient.mockResolvedValue([
        { id: 'inv-new', invoiceNumber: 'INV-000042', kind: 'sale', orderId: 'order-1', dueDate: '2026-10-03', outstanding: '2800.00' },
      ]);

      await service.issueSaleInvoiceWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'pay-early', invoiceId: 'inv-new', amount: '1000.00' },
      ]);
    });

    it('never invoices the same order twice', async () => {
      repo.findInvoiceByOrderWithClient.mockResolvedValue({ id: 'inv-old' } as never);

      const result = await service.issueSaleInvoiceWithClient(fakeClient, 'tenant-1', 'user-1', input);

      expect(result).toEqual({ id: 'inv-old' });
      expect(ledger.postWithClient).not.toHaveBeenCalled();
      expect(repo.insertInvoiceWithClient).not.toHaveBeenCalled();
    });

    it('issues no invoice for an order worth nothing', async () => {
      repo.priceLinesWithClient.mockResolvedValue({ amounts: ['0.00'], total: '0.00' });

      const result = await service.issueSaleInvoiceWithClient(fakeClient, 'tenant-1', 'user-1', { ...input, costOfGoods: null });

      expect(result).toBeNull();
      expect(repo.insertInvoiceWithClient).not.toHaveBeenCalled();
    });
  });

  describe('recordPayment', () => {
    const open = [
      { id: 'inv-a', invoiceNumber: 'INV-000001', kind: 'sale' as const, orderId: 'o-a', dueDate: '2026-09-01', outstanding: '600.00' },
      { id: 'inv-b', invoiceNumber: 'INV-000002', kind: 'sale' as const, orderId: 'o-b', dueDate: '2026-09-10', outstanding: '900.00' },
    ];

    it('applies oldest due first and posts Dr Bank (net of fee) + Dr Finance costs / Cr AR (gross)', async () => {
      repo.openInvoicesForCustomerWithClient.mockResolvedValue(open);

      await service.recordPayment('tenant-1', 'user-1', {
        customerId: 'cust-1',
        amount: 1000,
        feeAmount: 12.5,
        method: 'upi',
        reference: 'UTR123',
      });

      expect(repo.lockCustomerWithClient).toHaveBeenCalledWith(fakeClient, 'cust-1');
      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'pay-1', invoiceId: 'inv-a', amount: '600.00' },
        { paymentId: 'pay-1', invoiceId: 'inv-b', amount: '400.00' },
      ]);
      expect(postings()[0]).toMatchObject({
        entryType: 'payment_received',
        lines: [
          { account: 'bank', debit: '987.50' },
          { account: 'finance_costs', debit: '12.50' },
          { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, credit: '1000.00' },
        ],
      });
    });

    it('books cash to the cash drawer and keeps the unapplied rest on account', async () => {
      repo.openInvoicesForCustomerWithClient.mockResolvedValue([open[0]]);

      await service.recordPayment('tenant-1', 'user-1', { customerId: 'cust-1', amount: 750, method: 'cash' });

      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'pay-1', invoiceId: 'inv-a', amount: '600.00' },
      ]);
      expect(postings()[0].lines[0]).toEqual({ account: 'cash_on_hand', debit: '750.00' });
    });

    it('honours explicit allocations and rejects one larger than the invoice balance', async () => {
      repo.openInvoicesForCustomerWithClient.mockResolvedValue(open);

      await service.recordPayment('tenant-1', 'user-1', {
        customerId: 'cust-1',
        amount: 500,
        method: 'cheque',
        allocations: [{ invoiceId: 'inv-b', amount: 500 }],
      });
      expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
        { paymentId: 'pay-1', invoiceId: 'inv-b', amount: '500.00' },
      ]);

      await expect(
        service.recordPayment('tenant-1', 'user-1', {
          customerId: 'cust-1',
          amount: 700,
          method: 'cheque',
          allocations: [{ invoiceId: 'inv-a', amount: 700 }],
        }),
      ).rejects.toThrow(/INV-000001 has only 600.00 outstanding/);
    });

    it('rejects allocations adding up to more than the payment, and a fee as large as it', async () => {
      repo.openInvoicesForCustomerWithClient.mockResolvedValue(open);
      await expect(
        service.recordPayment('tenant-1', 'user-1', {
          customerId: 'cust-1',
          amount: 100,
          method: 'upi',
          allocations: [
            { invoiceId: 'inv-a', amount: 60 },
            { invoiceId: 'inv-b', amount: 60 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.recordPayment('tenant-1', 'user-1', { customerId: 'cust-1', amount: 100, feeAmount: 100, method: 'upi' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a payment dated in the future', async () => {
      await expect(
        service.recordPayment('tenant-1', 'user-1', {
          customerId: 'cust-1',
          amount: 100,
          method: 'upi',
          receivedAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('a trip collection pays its own order first, then the oldest due', async () => {
    repo.openInvoicesForCustomerWithClient.mockResolvedValue([
      { id: 'inv-old', invoiceNumber: 'INV-000001', kind: 'sale', orderId: 'o-old', dueDate: '2026-09-01', outstanding: '300.00' },
      { id: 'inv-this', invoiceNumber: 'INV-000009', kind: 'sale', orderId: 'o-this', dueDate: '2026-10-01', outstanding: '500.00' },
    ]);

    await service.recordCollectionPaymentWithClient(fakeClient, 'tenant-1', 'driver-1', {
      collectionId: 'col-1',
      customerId: 'cust-1',
      orderId: 'o-this',
      amount: '650.00',
      method: 'cash',
      notes: null,
      collectedAt: new Date(),
    });

    expect(repo.insertAllocationsWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', [
      { paymentId: 'pay-1', invoiceId: 'inv-this', amount: '500.00' },
      { paymentId: 'pay-1', invoiceId: 'inv-old', amount: '150.00' },
    ]);
    expect(repo.insertPaymentWithClient).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ collectionId: 'col-1' }));
  });

  describe('reversePayment', () => {
    it('adds a reversal and posts the original entry mirrored, linked to it', async () => {
      ledger.findEntryWithClient.mockResolvedValue({
        id: 'entry-orig',
        lines: [
          { account: 'bank', partyType: null, partyId: null, debit: '987.50', credit: '0.00' },
          { account: 'finance_costs', partyType: null, partyId: null, debit: '12.50', credit: '0.00' },
          { account: 'accounts_receivable', partyType: 'customer', partyId: 'cust-1', debit: '0.00', credit: '1000.00' },
        ],
      });

      await service.reversePayment('tenant-1', 'user-1', 'pay-1', 'Cheque returned');

      expect(repo.insertReversalWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'pay-1', 'Cheque returned', 'user-1');
      expect(postings()[0]).toMatchObject({
        entryType: 'payment_reversed',
        reversesEntryId: 'entry-orig',
        lines: [
          { account: 'bank', debit: '0.00', credit: '987.50' },
          { account: 'finance_costs', debit: '0.00', credit: '12.50' },
          { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, debit: '1000.00', credit: '0.00' },
        ],
      });
    });

    it('refuses to reverse the same payment twice', async () => {
      repo.findPaymentWithClient.mockResolvedValue({ id: 'pay-1', customerId: 'cust-1', reversedAt: new Date() } as never);
      await expect(service.reversePayment('tenant-1', 'user-1', 'pay-1', 'again')).rejects.toBeInstanceOf(ConflictException);
      expect(ledger.postWithClient).not.toHaveBeenCalled();
    });
  });

  describe('runFinanceCharges', () => {
    const candidate = {
      invoiceId: 'inv-a',
      invoiceNumber: 'INV-000001',
      customerId: 'cust-1',
      dueDate: '2026-09-01',
      outstanding: '10000.00',
      rateMonthly: '2.00',
      graceDays: 5,
      lastPeriodEnd: null,
    };
    const openA = { id: 'inv-a', invoiceNumber: 'INV-000001', kind: 'sale' as const, orderId: 'o', dueDate: '2026-09-01', outstanding: '10000.00' };

    it('charges from the end of grace to asOf on the balance owed now, as its own invoice', async () => {
      repo.financeChargeCandidatesWithClient.mockResolvedValue([candidate]);
      repo.openInvoicesForCustomerWithClient.mockResolvedValue([openA]);
      repo.nextInvoiceNumberWithClient.mockResolvedValue('FC-000001');

      await service.runFinanceCharges('tenant-1', 'user-1', '2026-09-21');

      // grace ends 2026-09-06; 15 days to 2026-09-21; 10000 × 2% × 15/30 = 100.00
      expect(repo.insertFinanceChargeWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ periodStart: '2026-09-06', periodEnd: '2026-09-21', days: 15, amount: '100.00', principal: '10000.00' }),
      );
      expect(repo.insertInvoiceWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ kind: 'finance_charge', sourceInvoiceId: 'inv-a', orderId: null, amount: '100.00' }),
      );
      expect(postings()[0]).toMatchObject({
        entryType: 'finance_charge_accrued',
        lines: [
          { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, debit: '100.00' },
          { account: 'finance_charge_income', credit: '100.00' },
        ],
      });
    });

    it('continues from where the last charge ended', async () => {
      repo.financeChargeCandidatesWithClient.mockResolvedValue([{ ...candidate, lastPeriodEnd: '2026-09-21' }]);
      repo.openInvoicesForCustomerWithClient.mockResolvedValue([openA]);

      await service.runFinanceCharges('tenant-1', 'user-1', '2026-09-24');

      expect(repo.insertFinanceChargeWithClient).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ periodStart: '2026-09-21', days: 3, amount: '20.00' }),
      );
    });

    it('defers a charge under the minimum instead of posting it', async () => {
      repo.financeChargeCandidatesWithClient.mockResolvedValue([candidate]);
      repo.openInvoicesForCustomerWithClient.mockResolvedValue([{ ...openA, outstanding: '40.00' }]);

      const result = await service.runFinanceCharges('tenant-1', 'user-1', '2026-09-08');

      // 40 × 2% × 2/30 = 0.05 < 1.00
      expect(result.deferredBelowMinimum).toBe(1);
      expect(repo.insertFinanceChargeWithClient).not.toHaveBeenCalled();
    });

    it('skips an invoice paid off between the scan and the lock', async () => {
      repo.financeChargeCandidatesWithClient.mockResolvedValue([candidate]);
      repo.openInvoicesForCustomerWithClient.mockResolvedValue([]);

      const result = await service.runFinanceCharges('tenant-1', 'user-1', '2026-09-21');

      expect(result.charged).toBe(0);
      expect(ledger.postWithClient).not.toHaveBeenCalled();
    });

    it('refuses an asOf in the future', async () => {
      await expect(service.runFinanceCharges('tenant-1', 'user-1', '2026-12-31')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
