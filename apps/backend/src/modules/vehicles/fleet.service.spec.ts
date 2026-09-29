import { PoolClient } from 'pg';
import { FleetService, documentState } from './fleet.service';
import { FleetRepository } from './repositories/fleet.repository';

const client = {} as PoolClient;
const books = { today: '2026-09-29', timezone: 'Asia/Kolkata', currency: 'INR' };

function setup(overrides: Partial<Record<keyof FleetRepository, jest.Mock>> = {}) {
  const repo = {
    books: jest.fn().mockResolvedValue(books),
    instant: jest.fn().mockResolvedValue(new Date('2026-09-01T06:30:00Z')),
    settings: jest.fn().mockResolvedValue({ documentReminderDays: 30, blockTripsOnExpired: true, version: 0 }),
    vehicleExists: jest.fn().mockResolvedValue({ registration_number: 'KA01AB1234', status: 'active', ownership: 'owned' }),
    documents: jest.fn().mockResolvedValue([]),
    vehicles: jest.fn().mockResolvedValue([]),
    maintenance: jest.fn().mockResolvedValue([]),
    loans: jest.fn().mockResolvedValue([]),
    contracts: jest.fn().mockResolvedValue([]),
    bills: jest.fn().mockResolvedValue([]),
    fuel: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as jest.Mocked<FleetRepository>;
  const ledger = { postSystemWithClient: jest.fn().mockResolvedValue('entry-1') };
  const taxRules = { recordDeductionWithClient: jest.fn().mockResolvedValue('ded-1') };
  const taxRulesRepo = { tdsSection: jest.fn() };
  const audit = { record: jest.fn() };
  const db = { withTenant: jest.fn((_t: string, work: (c: PoolClient) => unknown) => work(client)) };
  const service = new FleetService(db as never, repo, ledger as never, taxRules as never, taxRulesRepo as never, audit as never);
  // detail() is exercised by the e2e suite; here the postings are the point.
  jest.spyOn(service as unknown as { detail: () => Promise<unknown> }, 'detail').mockResolvedValue({});
  return { service, repo, ledger, taxRules, taxRulesRepo };
}

describe('documentState', () => {
  it('expired, expiring inside the reminder window, valid, or never expiring', () => {
    expect(documentState('2026-09-28', '2026-09-29', 30)).toBe('expired');
    expect(documentState('2026-09-29', '2026-09-29', 30)).toBe('expiring');
    expect(documentState('2026-10-29', '2026-09-29', 30)).toBe('expiring');
    expect(documentState('2026-10-30', '2026-09-29', 30)).toBe('valid');
    expect(documentState(null, '2026-09-29', 30)).toBe('no_expiry');
  });
});

describe('FleetService', () => {
  describe('assertRoadworthyWithClient', () => {
    const expiredInsurance = { doc_type: 'insurance', valid_until: '2026-09-01', superseded: false };

    it('refuses a vehicle whose current insurance has lapsed', async () => {
      const { service } = setup({ documents: jest.fn().mockResolvedValue([expiredInsurance]) });
      await expect(service.assertRoadworthyWithClient(client, 'v1')).rejects.toThrow(/Insurance \(expired 2026-09-01\)/);
    });

    it('ignores a lapsed document that a renewal superseded', async () => {
      const { service } = setup({ documents: jest.fn().mockResolvedValue([{ ...expiredInsurance, superseded: true }]) });
      await expect(service.assertRoadworthyWithClient(client, 'v1')).resolves.toBeUndefined();
    });

    it('only advises when the tenant turned blocking off', async () => {
      const { service } = setup({
        documents: jest.fn().mockResolvedValue([expiredInsurance]),
        settings: jest.fn().mockResolvedValue({ documentReminderDays: 30, blockTripsOnExpired: false, version: 1 }),
      });
      await expect(service.assertRoadworthyWithClient(client, 'v1')).resolves.toBeUndefined();
    });

    it('never sends out a vehicle in maintenance', async () => {
      const { service } = setup({
        vehicleExists: jest.fn().mockResolvedValue({ registration_number: 'KA01AB1234', status: 'maintenance', ownership: 'owned' }),
      });
      await expect(service.assertRoadworthyWithClient(client, 'v1')).rejects.toThrow(/not active/);
    });
  });

  describe('dispose (VEH.3–5)', () => {
    const asset = { capitalized_on: '2026-04-16', cost: '1200000.00', salvage_value: '120000.00', method: 'straight_line', useful_life_months: 96, annual_rate: null, accumulated: '50625.00' };
    const dto = { disposedOn: '2026-09-10', method: 'sold' as const, proceeds: 1100000, receivedInto: 'bank' as const };

    it('wants depreciation through the month before', async () => {
      const { service, ledger } = setup({
        lockDepreciation: jest.fn(),
        asset: jest.fn().mockResolvedValue({ ...asset, depreciated_through: '2026-07-01' }),
      });
      await expect(service.dispose('t', 'u', 'v1', dto)).rejects.toThrow(/through 2026-08/);
      expect(ledger.postSystemWithClient).not.toHaveBeenCalled();
    });

    it('posts proceeds and accumulated depreciation against cost, the rest a gain', async () => {
      const { service, ledger, repo } = setup({
        lockDepreciation: jest.fn(),
        asset: jest.fn().mockResolvedValue({ ...asset, depreciated_through: '2026-08-01' }),
        insertDisposal: jest.fn(),
        setVehicleStatus: jest.fn(),
      });
      await service.dispose('t', 'u', 'v1', dto);
      // NBV 1,200,000 − 50,625 = 1,149,375; sold for 1,100,000 → loss 49,375
      expect(ledger.postSystemWithClient.mock.calls[0][1].lines).toEqual([
        { account: 'bank', debit: '1100000.00' },
        { account: 'accumulated_depreciation', debit: '50625.00' },
        { account: 'fixed_assets_vehicles', credit: '1200000.00' },
        { account: 'loss_on_disposal', debit: '49375.00' },
      ]);
      expect(repo.insertDisposal).toHaveBeenCalledWith(client, expect.objectContaining({ netBookValue: '1149375.00', gainLoss: '-49375.00' }));
      expect(repo.setVehicleStatus).toHaveBeenCalledWith(client, 'v1', 'disposed');
    });
  });

  describe('payEmi', () => {
    const loan = {
      id: 'l1', vehicle_id: 'v1', lender: 'HDFC', principal: '1000000.00', principal_repaid: '0.00', annual_rate: '9.00',
      emi: '20758.36', disbursed_on: '2026-04-01', status: 'active', version: 1, installments_paid: 0,
    };

    it('splits the EMI into the month\'s interest and principal', async () => {
      const { service, ledger, repo } = setup({
        loanForUpdate: jest.fn().mockResolvedValue(loan),
        loanPayments: jest.fn().mockResolvedValue([]),
        insertLoanPayment: jest.fn(),
        touchLoan: jest.fn(),
      });
      await service.payEmi('t', 'u', 'l1', { version: 1, paidOn: '2026-05-05', paidFrom: 'bank' });
      expect(ledger.postSystemWithClient.mock.calls[0][1].lines).toEqual([
        { account: 'vehicle_loans', debit: '13258.36' },
        { account: 'loan_interest', debit: '7500.00' },
        { account: 'bank', credit: '20758.36' },
      ]);
      expect(repo.touchLoan).toHaveBeenCalledWith(client, 'l1', false);
    });

    it('the last payment clears it and closes the loan; paying more is refused', async () => {
      const nearlyDone = { ...loan, principal_repaid: '995000.00', installments_paid: 59 };
      const { service, repo } = setup({
        loanForUpdate: jest.fn().mockResolvedValue(nearlyDone),
        loanPayments: jest.fn().mockResolvedValue([]),
        insertLoanPayment: jest.fn(),
        touchLoan: jest.fn(),
      });
      await expect(service.payEmi('t', 'u', 'l1', { version: 1, paidOn: '2026-09-05', paidFrom: 'bank', amount: 9000 })).rejects.toThrow(/5037.50 clears/);
      await service.payEmi('t', 'u', 'l1', { version: 1, paidOn: '2026-09-05', paidFrom: 'bank' });
      expect(repo.insertLoanPayment).toHaveBeenCalledWith(client, expect.objectContaining({ installmentNo: 60, interest: '37.50', principal: '5000.00' }));
      expect(repo.touchLoan).toHaveBeenCalledWith(client, 'l1', true);
    });

    it('refuses a stale form', async () => {
      const { service } = setup({ loanForUpdate: jest.fn().mockResolvedValue({ ...loan, version: 3 }) });
      await expect(service.payEmi('t', 'u', 'l1', { version: 1, paidOn: '2026-05-05', paidFrom: 'bank' })).rejects.toThrow(/someone else/);
    });
  });

  describe('payHireBill', () => {
    const bill = {
      id: 'b1', vehicleId: 'v1', registrationNumber: 'KA05HH0001', contractId: 'c1', ownerName: 'Ravi Transport', periodStart: '2026-08-01',
      periodEnd: '2026-08-31', quantity: '20.000', rate: '2500.00', amount: '50000.00', status: 'unpaid', version: 1,
    };
    const contract = { id: 'c1', vehicleId: 'v1', ownerName: 'Ravi Transport', ownerPan: 'ABCPR1234K', rateBasis: 'per_day', rate: '2500.00' };
    const section = { id: 's1', code: '194C', rateIndividual: '1.000', rateOther: '2.000', rateNoPan: '20.000' };

    it('withholds TDS at the individual rate for a P-type PAN and records the deduction', async () => {
      const { service, ledger, taxRules, taxRulesRepo } = setup({
        findBill: jest.fn().mockResolvedValue(bill),
        contracts: jest.fn().mockResolvedValue([contract]),
        markBillPaid: jest.fn().mockResolvedValue(true),
      });
      taxRulesRepo.tdsSection.mockResolvedValue(section);
      await service.payHireBill('t', 'u', 'b1', { version: 1, paidOn: '2026-09-10', paidFrom: 'bank', tdsSectionCode: '194C' });
      expect(ledger.postSystemWithClient.mock.calls[0][1].lines).toEqual([
        { account: 'hire_payable', debit: '50000.00' },
        { account: 'bank', credit: '49500.00' },
        { account: 'tds_payable', credit: '500.00' },
      ]);
      expect(taxRules.recordDeductionWithClient).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ sectionCode: '194C', deducteeType: 'individual_huf', tdsAmount: '500.00', sourceType: 'hire_bill_payment', sourceId: 'b1' }),
      );
    });

    it('without a section, pays the bill in full', async () => {
      const { service, ledger, taxRules } = setup({
        findBill: jest.fn().mockResolvedValue(bill),
        contracts: jest.fn().mockResolvedValue([contract]),
        markBillPaid: jest.fn().mockResolvedValue(true),
      });
      await service.payHireBill('t', 'u', 'b1', { version: 1, paidOn: '2026-09-10', paidFrom: 'cash_on_hand' });
      expect(ledger.postSystemWithClient.mock.calls[0][1].lines).toEqual([
        { account: 'hire_payable', debit: '50000.00' },
        { account: 'cash_on_hand', credit: '50000.00' },
        { account: 'tds_payable', credit: '0.00' },
      ]);
      expect(taxRules.recordDeductionWithClient).not.toHaveBeenCalled();
    });
  });

  describe('runDepreciation', () => {
    it("refuses a month that isn't over", async () => {
      const { service } = setup();
      await expect(service.runDepreciation('t', 'u', '2026-09')).rejects.toThrow(/isn't over/);
    });

    it('posts one entry per month, dated its last day', async () => {
      const asset = { vehicle_id: 'v1', registration_number: 'KA01AB1234', capitalized_on: '2026-07-16', cost: '1200000.00', salvage_value: '120000.00', method: 'straight_line', useful_life_months: 96, annual_rate: null, accumulated: '0.00', depreciated_through: null, disposed_on: null };
      const { service, ledger, repo } = setup({
        lockDepreciation: jest.fn(),
        assets: jest.fn().mockResolvedValue([asset]),
        asset: jest.fn().mockResolvedValue(asset),
        insertRun: jest.fn(),
        insertDepreciation: jest.fn(),
      });
      const result = await service.runDepreciation('t', 'u', '2026-08');
      expect(result.months).toEqual([
        { month: '2026-07', total: '5806.45', vehicles: 1 }, // 16 of 31 days × 11,250
        { month: '2026-08', total: '11250.00', vehicles: 1 },
      ]);
      expect(ledger.postSystemWithClient).toHaveBeenCalledTimes(2);
      expect(repo.instant).toHaveBeenCalledWith(client, 'Asia/Kolkata', '2026-09-29', '2026-07-31');
      expect(repo.insertDepreciation).toHaveBeenLastCalledWith(client, 't', expect.any(String), 'v1', '2026-08-01', '11250.00', '17056.45');
    });
  });
});
