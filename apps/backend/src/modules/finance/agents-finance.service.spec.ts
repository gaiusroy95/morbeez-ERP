import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AgentsFinanceService, LotCommissionInput } from './agents-finance.service';
import { LedgerPosting } from './repositories/ledger.repository';
import { AgentAccount } from './entities/finance-engine.entity';

// Master Spec v3 P6 — F4 (Master Spec §11; Accounting Engine AGT.1–AGT.3).
const client = {} as PoolClient;

function build(account: AgentAccount = { agentId: 'ag-1', name: 'Ravi (agent)', phone: null, pan: 'ABCPK1234F', status: 'active', earned: '720.00', settled: '0.00', owed: '720.00' }) {
  const postings: LedgerPosting<string>[] = [];
  const repo = {
    commissionOfLotWithClient: jest.fn().mockResolvedValue(null),
    lockAgentWithClient: jest.fn(),
    insertCommissionWithClient: jest.fn(),
    accountWithClient: jest.fn().mockResolvedValue(account),
    localDateWithClient: jest.fn().mockResolvedValue('2026-11-10'),
    insertPaymentWithClient: jest.fn(),
    findPaymentWithClient: jest.fn().mockResolvedValue({ id: 'pay-1' }),
  };
  const ledger = { postWithClient: jest.fn(async (_c: PoolClient, p: LedgerPosting<string>) => (postings.push(p), `entry-${postings.length}`)) };
  const audit = { record: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  const service = new AgentsFinanceService(db as never, repo as never, ledger as never, audit as never);
  return { service, repo, postings };
}

const lot: LotCommissionInput = {
  lotId: 'lot-1',
  purchaseOrderId: 'po-1',
  agentId: 'ag-1',
  agentName: 'Ravi (agent)',
  ratePerKg: '1.50',
  acceptedQuantity: '480.000',
  uom: 'kg',
  gradedAt: new Date('2026-11-10T06:00:00Z'),
};

describe('agent commission at grading (AGT.1–AGT.3)', () => {
  it('Dr Agent commission / Cr Accounts payable — agents: verified kg × commission per kg, traceable to lot and rate', async () => {
    const { service, postings, repo } = build();
    await service.accrueLotCommissionWithClient(client, 'tenant-1', 'owner-user', lot);
    expect(postings[0]).toMatchObject({
      entryType: 'agent_commission_accrued',
      occurredAt: lot.gradedAt,
      lines: [
        { account: 'agent_commission', debit: '720.00' },
        { account: 'accounts_payable_agent', party: { type: 'agent', id: 'ag-1' }, credit: '720.00' },
      ],
    });
    expect(repo.insertCommissionWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ lotId: 'lot-1', purchaseOrderId: 'po-1', acceptedKg: '480.000', ratePerKg: '1.50', amount: '720.00', entryId: 'entry-1' }),
    );
  });

  it('nothing for a lot with no weight, and never twice for one lot', async () => {
    const pieces = build();
    expect(await pieces.service.accrueLotCommissionWithClient(client, 'tenant-1', 'u', { ...lot, uom: 'piece' })).toBeNull();
    expect(pieces.postings).toHaveLength(0);
    const again = build();
    again.repo.commissionOfLotWithClient.mockResolvedValue('ac-1');
    expect(await again.service.accrueLotCommissionWithClient(client, 'tenant-1', 'u', lot)).toBeNull();
    expect(again.postings).toHaveLength(0);
  });
});

describe('paying an agent (AGT.2) — no TDS: the client confirmed it does not apply to agent commission', () => {
  it('Dr Accounts payable — agents / Cr bank or cash, the whole amount', async () => {
    const { service, postings, repo } = build();
    await service.recordPayment('tenant-1', 'owner-user', 'ag-1', { amount: 500, method: 'upi', reference: 'UTR1' });
    expect(postings[0].lines).toEqual([
      { account: 'accounts_payable_agent', party: { type: 'agent', id: 'ag-1' }, debit: '500.00' },
      { account: 'bank', credit: '500.00' },
    ]);
    expect(repo.insertPaymentWithClient).toHaveBeenCalledWith(client, expect.objectContaining({ amount: '500.00', tdsSection: null, tdsAmount: '0.00', reference: 'UTR1' }));
    const cash = build();
    await cash.service.recordPayment('tenant-1', 'owner-user', 'ag-1', { amount: 720, method: 'cash' });
    expect(cash.postings[0].lines[1]).toEqual({ account: 'cash_on_hand', credit: '720.00' });
  });

  it('no more than is owed, and more than nothing', async () => {
    const owed = build();
    await expect(owed.service.recordPayment('tenant-1', 'u', 'ag-1', { amount: 720.01, method: 'cash' })).rejects.toBeInstanceOf(ConflictException);
    await expect(owed.service.recordPayment('tenant-1', 'u', 'ag-1', { amount: 0, method: 'cash' })).rejects.toBeInstanceOf(BadRequestException);
    expect(owed.postings).toHaveLength(0);
  });
});
