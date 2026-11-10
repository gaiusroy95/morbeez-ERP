import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdjustmentsService, creditNoteAccount } from './adjustments.service';
import { AdjustableInvoice } from './repositories/adjustments.repository';
import { LedgerPosting } from './repositories/ledger.repository';

// Master Spec v3 P6 — F1 (Accounting Engine CN.1–CN.4) and F3 (BD.1, BD.2, BD.4).
const client = {} as PoolClient;

const invoice: AdjustableInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-000007',
  kind: 'sale',
  customerId: 'cust-1',
  customerName: 'Hotel Sagar',
  amount: '1050.00',
  outstanding: '1050.00',
  createdBy: 'driver-user',
};

function build(over: Partial<AdjustableInvoice> = {}, disputed = '0.00') {
  const postings: LedgerPosting<string>[] = [];
  const repo = {
    invoiceWithClient: jest.fn().mockResolvedValue({ ...invoice, ...over }),
    openDisputedWithClient: jest.fn().mockResolvedValue(disputed),
    taxedLinesWithClient: jest.fn().mockResolvedValue([
      { invoiceLineId: 'l-1', taxableValue: '1000.00', cgst: '25.00', sgst: '25.00', igst: '0.00', cess: '0.00' },
    ]),
    nextCreditNoteNumberWithClient: jest.fn().mockResolvedValue('CN-000001'),
    insertCreditNoteWithClient: jest.fn(),
    findCreditNoteWithClient: jest.fn().mockResolvedValue({ id: 'cn-1', creditNoteNumber: 'CN-000001' }),
    writeOffOfInvoiceWithClient: jest.fn().mockResolvedValue(null),
    insertWriteOffWithClient: jest.fn(),
    findWriteOffWithClient: jest.fn().mockResolvedValue({ id: 'wo-1' }),
  };
  const ledger = { postWithClient: jest.fn(async (_c: PoolClient, p: LedgerPosting<string>) => (postings.push(p), `entry-${postings.length}`)) };
  const receivables = { lockCustomerWithClient: jest.fn() };
  const customers = { holdForReviewWithClient: jest.fn() };
  const audit = { record: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  const service = new AdjustmentsService(db as never, repo as never, receivables as never, ledger as never, customers as never, audit as never);
  return { service, repo, ledger, postings, receivables, customers };
}

describe('credit notes (CN.1–CN.4)', () => {
  it('CN.1/CN.2: Dr Sales returns and the GST it carried, Cr the customer — the invoice untouched', async () => {
    const { service, postings, repo, receivables } = build();
    await service.issueCreditNote('tenant-1', 'owner-user', { invoiceId: 'inv-1', amount: 210, reason: 'Two crates soft' });
    expect(receivables.lockCustomerWithClient).toHaveBeenCalledWith(client, 'cust-1');
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      entryType: 'credit_note_issued',
      sourceType: 'credit_note',
      lines: [
        { account: 'sales_returns', debit: '200.00' },
        { account: 'output_cgst', debit: '5.00' },
        { account: 'output_sgst', debit: '5.00' },
        { account: 'output_igst', debit: '0.00' },
        { account: 'output_cess', debit: '0.00' },
        { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, credit: '210.00' },
      ],
    });
    expect(repo.insertCreditNoteWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        number: 'CN-000001',
        invoiceId: 'inv-1',
        taxableValue: '200.00',
        cgst: '5.00',
        sgst: '5.00',
        amount: '210.00',
        disputeId: null,
        entryId: 'entry-1',
        lines: [{ invoiceLineId: 'l-1', taxableValue: '200.00', cgst: '5.00', sgst: '5.00', igst: '0.00', cess: '0.00' }],
      }),
    );
  });

  it('CN.4: refused to whoever issued the invoice', async () => {
    const { service, ledger } = build();
    await expect(service.issueCreditNote('tenant-1', 'driver-user', { invoiceId: 'inv-1', amount: 10, reason: 'Soft' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ledger.postWithClient).not.toHaveBeenCalled();
  });

  it('never more than is outstanding, nor what another open dispute still claims', async () => {
    const paid = build({ outstanding: '100.00' });
    await expect(paid.service.issueCreditNote('tenant-1', 'owner-user', { invoiceId: 'inv-1', amount: 100.01, reason: 'Soft' })).rejects.toThrow(
      /Only ₹100.00 of INV-000007 is outstanding/,
    );
    const disputed = build({}, '1000.00');
    await expect(disputed.service.issueCreditNote('tenant-1', 'owner-user', { invoiceId: 'inv-1', amount: 60, reason: 'Soft' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(disputed.repo.openDisputedWithClient).toHaveBeenCalledWith(client, 'inv-1', null);
  });

  it('takes back from the income the invoice raised', () => {
    expect(creditNoteAccount('sale')).toBe('sales_returns');
    expect(creditNoteAccount('spot_sale')).toBe('sales_returns');
    expect(creditNoteAccount('finance_charge')).toBe('finance_charge_income');
    expect(creditNoteAccount('crate_charge')).toBe('crate_recoveries');
  });
});

describe('bad-debt write-off (BD.1, BD.2, BD.4)', () => {
  it('provides for it, writes it off against the provision, and holds the customer for review', async () => {
    const { service, postings, repo, customers } = build({ outstanding: '640.00' });
    await service.writeOff('tenant-1', 'owner-user', 'inv-1', { reason: 'Shop closed' });
    expect(postings.map((p) => p.entryType)).toEqual(['bad_debt_provisioned', 'receivable_written_off']);
    expect(postings[0].lines).toEqual([
      { account: 'bad_debt_expense', debit: '640.00' },
      { account: 'allowance_doubtful_accounts', credit: '640.00' },
    ]);
    expect(postings[1].lines).toEqual([
      { account: 'allowance_doubtful_accounts', debit: '640.00' },
      { account: 'accounts_receivable', party: { type: 'customer', id: 'cust-1' }, credit: '640.00' },
    ]);
    expect(repo.insertWriteOffWithClient).toHaveBeenCalledWith(client, expect.objectContaining({ amount: '640.00', provisionEntryId: 'entry-1', entryId: 'entry-2' }));
    expect(customers.holdForReviewWithClient).toHaveBeenCalledWith(
      client,
      'tenant-1',
      'owner-user',
      'cust-1',
      'Bad debt written off on INV-000007 (₹640.00) — review credit terms',
    );
  });

  it('not while a dispute is open, not twice, not when nothing is owed', async () => {
    const disputed = build({}, '50.00');
    await expect(disputed.service.writeOff('tenant-1', 'owner-user', 'inv-1', { reason: 'Gone' })).rejects.toThrow(/open dispute/);
    const twice = build();
    twice.repo.writeOffOfInvoiceWithClient.mockResolvedValue({ id: 'wo-0' });
    await expect(twice.service.writeOff('tenant-1', 'owner-user', 'inv-1', { reason: 'Gone' })).rejects.toThrow(/already been written off/);
    const settled = build({ outstanding: '0.00' });
    await expect(settled.service.writeOff('tenant-1', 'owner-user', 'inv-1', { reason: 'Gone' })).rejects.toThrow(/Nothing is outstanding/);
    for (const b of [disputed, twice, settled]) expect(b.ledger.postWithClient).not.toHaveBeenCalled();
  });
});
