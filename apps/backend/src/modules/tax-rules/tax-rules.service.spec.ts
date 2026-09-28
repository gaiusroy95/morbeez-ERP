import { PoolClient } from 'pg';
import { TaxRulesService } from './tax-rules.service';
import { DEFAULT_PROFILE, ResolvedLine, TaxRulesRepository } from './repositories/tax-rules.repository';
import { GstRateRule, TaxProfile, TdsSection } from './entities/tax-rules.entity';

const client = {} as PoolClient;

const regular: TaxProfile = {
  ...DEFAULT_PROFILE,
  registrationType: 'regular',
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
  version: 1,
};

const rule = (over: Partial<GstRateRule> = {}): GstRateRule => ({
  id: 'rule-1',
  tenantId: null,
  hsnCode: '0710',
  description: 'Frozen vegetables',
  supplyKind: 'goods',
  taxability: 'taxable',
  rate: '5.00',
  cessRate: '0.00',
  effectiveFrom: '2017-07-01',
  effectiveTo: null,
  ...over,
});

const section = (over: Partial<TdsSection> = {}): TdsSection => ({
  id: 'sec-1',
  tenantId: null,
  code: '194Q',
  description: 'Purchase of goods',
  rateIndividual: '0.100',
  rateOther: '0.100',
  rateNoPan: '5.000',
  singleThreshold: null,
  annualThreshold: '5000000.00',
  basis: 'excess_over_annual',
  effectiveFrom: '2025-04-01',
  effectiveTo: null,
  ...over,
});

describe('TaxRulesService', () => {
  let repo: jest.Mocked<TaxRulesRepository>;
  let service: TaxRulesService;

  beforeEach(() => {
    repo = {
      profile: jest.fn().mockResolvedValue(regular),
      resolveProducts: jest.fn(),
      customerTax: jest.fn().mockResolvedValue(null),
      farmerTax: jest.fn().mockResolvedValue({ name: 'Ramesh', pan: 'ABCPE1234F', deductee_type: null, tds_exempt: false }),
      tdsSection: jest.fn().mockResolvedValue(section()),
      taxedBaseThisYear: jest.fn().mockResolvedValue('0.00'),
      insertInvoiceTax: jest.fn(),
      insertDeduction: jest.fn(),
    } as unknown as jest.Mocked<TaxRulesRepository>;
    service = new TaxRulesService(repo);
  });

  const lines = (resolved: ResolvedLine[]) => repo.resolveProducts.mockResolvedValue(resolved);
  const invoice = (values: string[]) =>
    service.computeInvoiceTaxWithClient(client, {
      customerId: 'cust-1',
      issuedOn: '2026-09-27',
      lines: values.map((v, i) => ({ productId: `p${i}`, taxableValue: v })),
    });

  describe('GST on an invoice', () => {
    it('splits the rate into CGST and SGST inside the state', async () => {
      lines([{ hsn_code: '07101000', base_uom: 'kg', rule: rule() }]);
      const tax = await invoice(['2800.00']);
      expect(tax).toMatchObject({ documentType: 'tax_invoice', intraState: true, placeOfSupply: '27' });
      expect(tax.lines[0]).toMatchObject({ uqc: 'KGS', taxability: 'taxable', cgst: '70.00', sgst: '70.00', igst: '0.00', total: '2940.00' });
      expect(tax.total).toBe('2940.00');
    });

    it('charges IGST when the customer is in another state', async () => {
      repo.customerTax.mockResolvedValue({ gstin: '29AAGCB7383J1Z4', legal_name: 'B', state_code: '29', address_line1: null, city: null, pincode: null });
      lines([{ hsn_code: '0710', base_uom: 'kg', rule: rule() }]);
      const tax = await invoice(['1000.00']);
      expect(tax).toMatchObject({ intraState: false, placeOfSupply: '29', buyerGstin: '29AAGCB7383J1Z4', igst: '50.00', cgst: '0.00', total: '1050.00' });
    });

    it('rounds each half to the paisa, half up', async () => {
      lines([{ hsn_code: '0710', base_uom: 'kg', rule: rule({ rate: '18.00' }) }]);
      const tax = await invoice(['333.33']);
      // 333.33 × 9% = 29.9997 → 30.00 each
      expect(tax.lines[0]).toMatchObject({ cgst: '30.00', sgst: '30.00', total: '393.33' });
    });

    it('exempt vegetables are a bill of supply with no tax', async () => {
      lines([{ hsn_code: '0702', base_uom: 'kg', rule: rule({ hsnCode: '0702', taxability: 'exempt', rate: '0.00' }) }]);
      const tax = await invoice(['1600.00']);
      expect(tax.documentType).toBe('bill_of_supply');
      expect(tax.lines[0]).toMatchObject({ taxability: 'exempt', cgst: '0.00', total: '1600.00' });
    });

    it('an invoice mixing exempt and taxable goods is a tax invoice', async () => {
      lines([
        { hsn_code: '0702', base_uom: 'kg', rule: rule({ taxability: 'exempt', rate: '0.00' }) },
        { hsn_code: '0710', base_uom: 'kg', rule: rule() },
      ]);
      const tax = await invoice(['1600.00', '1000.00']);
      expect(tax).toMatchObject({ documentType: 'tax_invoice', taxableValue: '2600.00', cgst: '25.00', sgst: '25.00', total: '2650.00' });
    });

    it('a product with no HSN or no rule is left untaxed and marked unclassified — delivery never fails on it', async () => {
      lines([
        { hsn_code: null, base_uom: 'crate', rule: null },
        { hsn_code: '9999', base_uom: 'unit', rule: null },
      ]);
      const tax = await invoice(['500.00', '100.00']);
      expect(tax.lines.map((l) => [l.taxability, l.uqc])).toEqual([
        ['unclassified', 'OTH'],
        ['unclassified', 'NOS'],
      ]);
      expect(tax.total).toBe('600.00');
    });

    it('charges nothing when not registered, or on the composition scheme', async () => {
      lines([{ hsn_code: '0710', base_uom: 'kg', rule: rule() }]);
      repo.profile.mockResolvedValueOnce({ ...DEFAULT_PROFILE });
      const unregistered = await invoice(['1000.00']);
      expect(unregistered).toMatchObject({ documentType: 'invoice', total: '1000.00' });
      expect(unregistered.lines[0].taxability).toBe('not_registered');

      repo.profile.mockResolvedValueOnce({ ...regular, registrationType: 'composition' });
      const composition = await invoice(['1000.00']);
      expect(composition).toMatchObject({ documentType: 'bill_of_supply', total: '1000.00' });
    });

    it('adds cess on top of GST', async () => {
      lines([{ hsn_code: '0710', base_uom: 'kg', rule: rule({ rate: '28.00', cessRate: '12.00' }) }]);
      const tax = await invoice(['100.00']);
      expect(tax.lines[0]).toMatchObject({ cgst: '14.00', sgst: '14.00', cess: '12.00', total: '140.00' });
    });
  });

  describe('TDS on a farmer payable', () => {
    const assess = (amount: string, prior: string) =>
      service.assessFarmerTdsWithClient(client, { farmerId: 'f1', amount, date: '2026-09-20', priorThisYear: prior });

    it('nothing unless the tenant applies a section to farmer purchases', async () => {
      expect(await assess('100000.00', '9000000.00')).toBeNull();
    });

    describe('with 194Q applied', () => {
      beforeEach(() => repo.profile.mockResolvedValue({ ...regular, farmerTdsSection: '194Q' }));

      it('taxes only the part of the year above ₹50 lakh', async () => {
        expect(await assess('100000.00', '4900000.00')).toBeNull(); // lands exactly on the limit
        const crossing = await assess('100000.00', '4990000.00');
        expect(crossing).toMatchObject({ baseAmount: '90000.00', rate: '0.100', tdsAmount: '90.00', deducteeType: 'individual_huf' });
        const above = await assess('100000.00', '6000000.00');
        expect(above).toMatchObject({ baseAmount: '100000.00', tdsAmount: '100.00' });
      });

      it('applies the higher no-PAN rate when the farmer has no PAN', async () => {
        repo.farmerTax.mockResolvedValue({ name: 'Ramesh', pan: null, deductee_type: null, tds_exempt: false });
        expect(await assess('100000.00', '6000000.00')).toMatchObject({ deducteeType: 'no_pan', rate: '5.000', tdsAmount: '5000.00' });
      });

      it('skips a farmer marked exempt', async () => {
        repo.farmerTax.mockResolvedValue({ name: 'Ramesh', pan: 'ABCPE1234F', deductee_type: null, tds_exempt: true });
        expect(await assess('100000.00', '6000000.00')).toBeNull();
      });
    });

    describe('with a section taxed in full once a limit is crossed', () => {
      beforeEach(() => {
        repo.profile.mockResolvedValue({ ...regular, farmerTdsSection: '194C' });
        repo.tdsSection.mockResolvedValue(
          section({ code: '194C', rateIndividual: '1.000', rateOther: '2.000', singleThreshold: '30000.00', annualThreshold: '100000.00', basis: 'full_once_crossed' }),
        );
        repo.farmerTax.mockResolvedValue({ name: 'Transport Co', pan: 'AAACT1234Q', deductee_type: null, tds_exempt: false });
      });

      it('nothing below both limits', async () => {
        expect(await assess('20000.00', '50000.00')).toBeNull();
      });

      it('a single payment above its limit is taxed on its own; the company rate applies to a C-type PAN', async () => {
        expect(await assess('40000.00', '0.00')).toMatchObject({ baseAmount: '40000.00', rate: '2.000', tdsAmount: '800.00', deducteeType: 'other' });
      });

      it('crossing the annual limit catches up earlier untaxed amounts', async () => {
        repo.taxedBaseThisYear.mockResolvedValue('40000.00'); // one earlier payment was taxed on its own
        const result = await assess('20000.00', '90000.00');
        // base = 20,000 now + (90,000 − 40,000 already taxed) = 70,000; 2% = 1,400
        expect(result).toMatchObject({ baseAmount: '70000.00', tdsAmount: '1400.00' });
      });
    });
  });
});
