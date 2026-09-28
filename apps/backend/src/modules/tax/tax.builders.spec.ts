import { buildGstr1, buildGstr3b } from './tax.service';
import { buildEinvoiceJson, EinvoiceSource, missingData, notApplicableReason } from './einvoice';
import { GstLineRow } from './repositories/tax.repository';
import { DEFAULT_PROFILE } from '../tax-rules/repositories/tax-rules.repository';
import { TaxProfile } from '../tax-rules/entities/tax-rules.entity';
import { deducteeTypeFromPan, gstinProblem, tdsDepositDueDate, tdsQuarter, financialYear } from '../../common/india';
import { multiplyToMoney, percentOfMoney } from '../../common/money';

const profile: TaxProfile = {
  ...DEFAULT_PROFILE,
  registrationType: 'regular',
  gstin: '27AAPFU0939F1ZV',
  legalName: 'Dev Wholesaler Co.',
  addressLine1: 'Shop 12, APMC Market',
  city: 'Navi Mumbai',
  pincode: '400703',
  stateCode: '27',
  einvoiceEnabled: true,
  version: 1,
};

const line = (over: Partial<GstLineRow>): GstLineRow => ({
  invoice_id: 'i1',
  invoice_number: 'INV-000001',
  issued_on: '2026-09-10',
  customer_name: 'Hotel Sagar',
  buyer_gstin: null,
  place_of_supply: '27',
  intra_state: true,
  invoice_total: '1000.00',
  taxability: 'taxable',
  hsn_code: '0710',
  uqc: 'KGS',
  gst_rate: '5.00',
  quantity: '10.000',
  taxable_value: '1000.00',
  cgst: '25.00',
  sgst: '25.00',
  igst: '0.00',
  cess: '0.00',
  ...over,
});

describe('GSTR-1 builder', () => {
  const lines: GstLineRow[] = [
    // B2B, taxable
    line({ invoice_id: 'i1', invoice_number: 'INV-000001', buyer_gstin: '27AABCH1234A1Z5', invoice_total: '1050.00' }),
    // B2B, exempt line on the same invoice
    line({ invoice_id: 'i1', invoice_number: 'INV-000001', buyer_gstin: '27AABCH1234A1Z5', taxability: 'exempt', hsn_code: '0702', gst_rate: '0.00', taxable_value: '500.00', cgst: '0.00', sgst: '0.00', quantity: '20.000' }),
    // B2CL: unregistered, inter-state, above ₹1 lakh
    line({ invoice_id: 'i2', invoice_number: 'INV-000002', place_of_supply: '29', intra_state: false, invoice_total: '157500.00', taxable_value: '150000.00', cgst: '0.00', sgst: '0.00', igst: '7500.00' }),
    // B2CS: two small intra-state sales at 5%
    line({ invoice_id: 'i3', invoice_number: 'INV-000003', taxable_value: '200.00', cgst: '5.00', sgst: '5.00', quantity: '2.500' }),
    line({ invoice_id: 'i4', invoice_number: 'INV-000004', taxable_value: '300.00', cgst: '7.50', sgst: '7.50', quantity: '3.000' }),
    // Unclassified
    line({ invoice_id: 'i5', invoice_number: 'INV-000005', taxability: 'unclassified', hsn_code: null, gst_rate: '0.00', cgst: '0.00', sgst: '0.00' }),
  ];

  it('sorts taxable lines into B2B, B2CL, and B2CS, and exempt ones into the nil table', () => {
    const r = buildGstr1('INR', '2026-09-01', '2026-09-30', profile, lines, 0);
    expect(r.b2b).toHaveLength(1);
    expect(r.b2b[0]).toMatchObject({ buyerGstin: '27AABCH1234A1Z5', invoiceNumber: 'INV-000001', rates: [{ rate: '5.00', taxableValue: '1000.00', cgst: '25.00' }] });
    expect(r.b2cl).toEqual([
      expect.objectContaining({ invoiceNumber: 'INV-000002', placeOfSupply: '29', rates: [expect.objectContaining({ igst: '7500.00' })] }),
    ]);
    expect(r.b2cs).toEqual([expect.objectContaining({ placeOfSupply: '27', rate: '5.00', taxableValue: '500.00', cgst: '12.50', sgst: '12.50' })]);
    expect(r.nil.find((n) => n.description.startsWith('Intra-state supplies to registered'))?.exempt).toBe('500.00');
  });

  it('summarises by HSN, split B2B / B2C, with exact quantities', () => {
    const r = buildGstr1('INR', '2026-09-01', '2026-09-30', profile, lines, 0);
    expect(r.hsn.b2b.map((h) => [h.hsnCode, h.quantity, h.taxableValue])).toEqual([
      ['0710', '10.000', '1000.00'],
      ['0702', '20.000', '500.00'],
    ]);
    const b2c0710 = r.hsn.b2c.find((h) => h.hsnCode === '0710' && h.rate === '5.00');
    expect(b2c0710).toMatchObject({ quantity: '15.500', taxableValue: '150500.00', totalValue: '158025.00' });
  });

  it('flags unclassified lines and finance-charge invoices, and counts the documents', () => {
    const r = buildGstr1('INR', '2026-09-01', '2026-09-30', profile, lines, 2);
    expect(r.issues.join(' ')).toMatch(/INV-000005/);
    expect(r.issues.join(' ')).toMatch(/2 finance-charge/);
    expect(r.documents).toMatchObject({ from: 'INV-000001', to: 'INV-000005', issued: 5 });
  });

  it('GSTR-3B totals outward tax and inter-state sales to unregistered buyers', () => {
    const r = buildGstr3b('INR', '2026-09-01', '2026-09-30', profile, lines);
    expect(r.outwardTaxable).toEqual({ taxableValue: '151500.00', igst: '7500.00', cgst: '37.50', sgst: '37.50', cess: '0.00' });
    expect(r.outwardNilExempt).toBe('500.00');
    expect(r.interStateToUnregistered).toEqual([{ placeOfSupply: '29', taxableValue: '150000.00', igst: '7500.00' }]);
  });
});

describe('e-invoice', () => {
  const source: EinvoiceSource = {
    invoiceNumber: 'INV-000001',
    issuedOn: '2026-09-10',
    documentType: 'tax_invoice',
    seller: { gstin: '27AAPFU0939F1ZV', legalName: 'Dev Wholesaler Co.', addressLine1: 'Shop 12', city: 'Navi Mumbai', pincode: '400703', stateCode: '27' },
    buyer: { gstin: '29AAGCB7383J1Z4', legalName: 'B Foods', addressLine1: '1 MG Road', city: 'Bengaluru', pincode: '560001', stateCode: '29' },
    placeOfSupply: '29',
    lines: [
      {
        description: 'Frozen peas',
        hsnCode: '07102100',
        uqc: 'KGS',
        quantity: '10.000',
        unitPrice: '100.00',
        taxableValue: '1000.00',
        taxability: 'taxable',
        gstRate: '5.00',
        cessRate: '0.00',
        cgst: '0.00',
        sgst: '0.00',
        igst: '50.00',
        cess: '0.00',
      },
    ],
    totals: { taxableValue: '1000.00', cgst: '0.00', sgst: '0.00', igst: '50.00', cess: '0.00', total: '1050.00' },
  };
  const settings = { enabled: true, hsnMinDigits: 6 };

  it('is ready when everything is filled in, and builds the IRP schema', () => {
    expect(notApplicableReason(source, settings)).toBeNull();
    expect(missingData(source, settings)).toEqual([]);
    const json = buildEinvoiceJson(source) as Record<string, any>;
    expect(json.Version).toBe('1.1');
    expect(json.DocDtls).toEqual({ Typ: 'INV', No: 'INV-000001', Dt: '10/09/2026' });
    expect(json.SellerDtls).toMatchObject({ Gstin: '27AAPFU0939F1ZV', Pin: 400703, Stcd: '27' });
    expect(json.BuyerDtls).toMatchObject({ Gstin: '29AAGCB7383J1Z4', Pos: '29', Stcd: '29' });
    expect(json.ItemList[0]).toMatchObject({ SlNo: '1', HsnCd: '07102100', IsServc: 'N', Qty: 10, Unit: 'KGS', AssAmt: 1000, GstRt: 5, IgstAmt: 50, TotItemVal: 1050 });
    expect(json.ValDtls).toMatchObject({ AssVal: 1000, IgstVal: 50, TotInvVal: 1050 });
  });

  it('is not applicable for B2C, a bill of supply, or when switched off', () => {
    expect(notApplicableReason({ ...source, buyer: { ...source.buyer, gstin: null } }, settings)).toMatch(/B2C/);
    expect(notApplicableReason({ ...source, documentType: 'bill_of_supply' }, settings)).toMatch(/bill of supply/);
    expect(notApplicableReason(source, { ...settings, enabled: false })).toMatch(/switched off/);
  });

  it('lists what is missing, including HSN codes shorter than required', () => {
    const issues = missingData(
      { ...source, buyer: { ...source.buyer, pincode: null }, lines: [{ ...source.lines[0], hsnCode: '0710' }] },
      settings,
    );
    expect(issues).toEqual([
      "The buyer's pincode (customer's tax details)",
      'Line 1 (Frozen peas) needs an HSN code of at least 6 digits',
    ]);
  });
});

describe('India identifiers and calendars', () => {
  it('validates a GSTIN check character', () => {
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
    expect(gstinProblem('27AAPFU0939F1ZX')).toMatch(/check character/);
    expect(gstinProblem('99AAPFU0939F1ZV')).toMatch(/not a GST state code/);
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/);
  });

  it('reads the PAN holder type', () => {
    expect(deducteeTypeFromPan('ABCPE1234F')).toBe('individual_huf');
    expect(deducteeTypeFromPan('ABCHE1234F')).toBe('individual_huf');
    expect(deducteeTypeFromPan('AAACT1234Q')).toBe('other');
  });

  it('financial years, quarters, and TDS deposit due dates', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect([tdsQuarter('2026-04-01'), tdsQuarter('2026-09-30'), tdsQuarter('2026-12-01'), tdsQuarter('2027-03-31')]).toEqual([1, 2, 3, 4]);
    expect(tdsDepositDueDate('2026-09-20')).toBe('2026-10-07');
    expect(tdsDepositDueDate('2026-12-31')).toBe('2027-01-07');
    expect(tdsDepositDueDate('2027-03-15')).toBe('2027-04-30');
  });

  it('exact percentages of money', () => {
    expect(percentOfMoney('2800.00', '5.00', 2)).toBe('70.00');
    expect(percentOfMoney('900.00', '0.1')).toBe('0.90');
    expect(percentOfMoney('0.10', '5')).toBe('0.01'); // 0.005 → half up
    expect(multiplyToMoney('10.000', '100.00')).toBe('1000.00');
  });
});
