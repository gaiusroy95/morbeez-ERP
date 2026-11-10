import { addDays, agentCommission, allocateInOrder, daysBetween, disputeCatchUp, financeChargeAnnual, laterDate, splitCreditNote, TaxedLine } from './finance-math';
import { compareMoney, minMoney, moneyFromNumber, subtractMoney, sumMoney } from '../../common/money';

const taxed = (id: string, taxableValue: string, gst: { cgst?: string; sgst?: string; igst?: string; cess?: string } = {}): TaxedLine => ({
  invoiceLineId: id,
  taxableValue,
  cgst: gst.cgst ?? '0.00',
  sgst: gst.sgst ?? '0.00',
  igst: gst.igst ?? '0.00',
  cess: gst.cess ?? '0.00',
});

describe('splitCreditNote (CN.1, GST Act s.34) — Master Spec v3 P6, F1', () => {
  it('credits an untaxed invoice line for line, adding up exactly', () => {
    const s = splitCreditNote('100.00', [taxed('a', '300.00'), taxed('b', '200.00')]);
    expect(s.lines).toEqual([taxed('a', '60.00'), taxed('b', '40.00')]);
    expect([s.taxableValue, s.cgst, s.amount]).toEqual(['100.00', '0.00', '100.00']);
  });

  it('takes back the GST the line carried, in proportion', () => {
    // ₹1,000 + 2.5% CGST + 2.5% SGST = ₹1,050; a ₹210 credit is a fifth of it.
    const s = splitCreditNote('210.00', [taxed('a', '1000.00', { cgst: '25.00', sgst: '25.00' })]);
    expect(s.lines).toEqual([taxed('a', '200.00', { cgst: '5.00', sgst: '5.00' })]);
    expect(sumMoney([s.taxableValue, s.cgst, s.sgst, s.igst, s.cess])).toBe('210.00');
  });

  it('gives the odd paisa to the largest remainders and never loses one', () => {
    const lines = [taxed('a', '33.33'), taxed('b', '33.33'), taxed('c', '33.34')];
    const s = splitCreditNote('10.00', lines);
    expect(sumMoney(s.lines.map((l) => l.taxableValue))).toBe('10.00');
    expect(s.lines.map((l) => l.taxableValue)).toEqual(['3.33', '3.33', '3.34']);
  });

  it('credits the whole invoice back to the paisa, taxes included', () => {
    const lines = [taxed('a', '847.46', { igst: '42.37' }), taxed('b', '120.00')];
    const s = splitCreditNote('1009.83', lines);
    expect(s.lines).toEqual(lines);
  });

  it('keeps every part of a mixed-rate split non-negative and summing to the note', () => {
    const lines = [taxed('a', '0.40', { cgst: '0.01', sgst: '0.01' }), taxed('b', '99.58', { igst: '17.92', cess: '0.09' })];
    for (const amount of ['0.01', '0.03', '7.77', '50.00', '118.01']) {
      const s = splitCreditNote(amount, lines);
      for (const l of s.lines) for (const v of Object.values(l).slice(1)) expect(compareMoney(v, '0')).toBeGreaterThanOrEqual(0);
      expect(sumMoney([s.taxableValue, s.cgst, s.sgst, s.igst, s.cess])).toBe(amount);
    }
  });

  it('refuses nothing, and more than the invoice carries', () => {
    expect(() => splitCreditNote('0.00', [taxed('a', '10.00')])).toThrow(/more than nothing/);
    expect(() => splitCreditNote('10.01', [taxed('a', '10.00')])).toThrow(/more than the invoice/);
  });
});

describe('agentCommission (MS §11; AGT.1, AGT.3) — Master Spec v3 P6, F4', () => {
  it('is verified kg × commission per kg', () => {
    expect(agentCommission('480.000', 'kg', '1.50')).toEqual({ kg: '480.000', amount: '720.00' });
    expect(agentCommission('12.345', 'kg', '2.00')).toEqual({ kg: '12.345', amount: '24.69' });
  });

  it('rounds half up to the paisa', () => {
    // 0.005 kg × ₹1.00 = ₹0.005 → ₹0.01; 0.004 kg → ₹0.00, so no commission.
    expect(agentCommission('0.005', 'kg', '1.00')).toEqual({ kg: '0.005', amount: '0.01' });
    expect(agentCommission('0.004', 'kg', '1.00')).toBeNull();
  });

  it('converts grams, and pays nothing on a lot with no weight', () => {
    expect(agentCommission('2500', 'g', '4.00')).toEqual({ kg: '2.500', amount: '10.00' });
    expect(agentCommission('300', 'piece', '0.50')).toBeNull();
    expect(agentCommission('20', 'crate', '0.50')).toBeNull();
  });

  it('no agent rate or nothing accepted: ₹0 (no entry)', () => {
    expect(agentCommission('100', 'kg', '0.00')).toBeNull();
    expect(agentCommission('0', 'kg', '1.00')).toBeNull();
  });
});

describe('disputeCatchUp (MS §32) — Master Spec v3 P6, F2', () => {
  const periods = [
    { periodStart: '2026-10-01', periodEnd: '2026-10-11', days: 10 },
    { periodStart: '2026-10-11', periodEnd: '2026-10-21', days: 10 },
  ];

  it('charges the unprotected principal for every paused day at once', () => {
    // ₹10,000 rejected × 18.25% × 20 days ÷ 365 = ₹100.00
    expect(disputeCatchUp('10000.00', '18.25', periods)).toEqual({ amount: '100.00', days: 20, periodStart: '2026-10-01', periodEnd: '2026-10-21' });
  });

  it('counts the paused days, not the span, when a pause stopped and started', () => {
    const gappy = [periods[0], { periodStart: '2026-11-01', periodEnd: '2026-11-04', days: 3 }];
    expect(disputeCatchUp('10000.00', '18.25', gappy)).toMatchObject({ days: 13, periodStart: '2026-10-01', periodEnd: '2026-11-04', amount: '65.00' });
  });

  it('has nothing to catch up when nothing paused or nothing is unprotected', () => {
    expect(disputeCatchUp('10000.00', '18.25', [])).toBeNull();
    expect(disputeCatchUp('0.00', '18.25', periods)).toBeNull();
  });
});

describe('allocateInOrder', () => {
  const items = [
    { id: 'a', outstanding: '100.00' },
    { id: 'b', outstanding: '250.50' },
    { id: 'c', outstanding: '40.00' },
  ];

  it('fills items in the order given, splitting the last one', () => {
    expect(allocateInOrder('150.25', items)).toEqual({
      allocations: [
        { id: 'a', amount: '100.00' },
        { id: 'b', amount: '50.25' },
      ],
      remainder: '0.00',
    });
  });

  it('returns what cannot be applied as the remainder', () => {
    const result = allocateInOrder('400.00', items);
    expect(result.allocations.map((a) => a.amount)).toEqual(['100.00', '250.50', '40.00']);
    expect(result.remainder).toBe('9.50');
  });

  it('skips items with nothing outstanding', () => {
    expect(allocateInOrder('10.00', [{ id: 'z', outstanding: '0.00' }, ...items]).allocations).toEqual([
      { id: 'a', amount: '10.00' },
    ]);
  });

  it('allocates nothing when there is nothing open', () => {
    expect(allocateInOrder('75.00', [])).toEqual({ allocations: [], remainder: '75.00' });
  });

  it('never loses a paisa across many small items', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), outstanding: '0.33' }));
    const result = allocateInOrder('10.00', many);
    expect(sumMoney([...result.allocations.map((a) => a.amount), result.remainder])).toBe('10.00');
    expect(result.remainder).toBe('0.10');
  });
});

describe('financeChargeAnnual (principal × annual rate × days ÷ 365)', () => {
  it.each([
    // principal, % a year, days, expected
    ['10000.00', '18.25', 15, '75.00'],
    ['10000.00', '18.00', 30, '147.95'], // 10000 × 0.18 × 30 ÷ 365 = 147.945…
    ['10000.00', '12.00', 365, '1200.00'],
    ['12345.67', '24.00', 17, '138.00'], // 12345.67 × 0.24 × 17 ÷ 365 = 138.0009…
  ])('%s at %s%% a year for %i days', (principal, rate, days, expected) => {
    expect(financeChargeAnnual(principal, rate, days)).toBe(expected);
  });

  it('rounds half up to the paisa', () => {
    // 36.50 × 10% × 1 ÷ 365 = 0.01 exactly; 18.25 × 10% × 1 ÷ 365 = 0.005 → 0.01; 10.00 × 10% × 1 ÷ 365 = 0.0027… → 0.00
    expect(financeChargeAnnual('36.50', '10.00', 1)).toBe('0.01');
    expect(financeChargeAnnual('18.25', '10.00', 1)).toBe('0.01');
    expect(financeChargeAnnual('10.00', '10.00', 1)).toBe('0.00');
  });

  it('charges nothing for no days, no rate, or no principal', () => {
    expect(financeChargeAnnual('5000.00', '18.00', 0)).toBe('0.00');
    expect(financeChargeAnnual('5000.00', '0.00', 30)).toBe('0.00');
    expect(financeChargeAnnual('0.00', '18.00', 30)).toBe('0.00');
    expect(financeChargeAnnual('5000.00', '18.00', -3)).toBe('0.00');
  });
});

describe('date helpers', () => {
  it('adds days across month and leap-year boundaries', () => {
    expect(addDays('2026-09-25', 7)).toBe('2026-10-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 0)).toBe('2026-12-31');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29);
    expect(daysBetween('2026-09-30', '2026-09-01')).toBe(-29);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // across the EU DST change: UTC-based, still 2
  });

  it('picks the later date', () => {
    expect(laterDate('2026-09-01', '2026-08-31')).toBe('2026-09-01');
    expect(laterDate('0000-01-01', '2026-01-05')).toBe('2026-01-05');
  });
});

describe('money helpers', () => {
  it('compares and picks exactly', () => {
    expect(compareMoney('0.10', '0.1')).toBe(0);
    expect(compareMoney('100.01', '100.1')).toBe(-1);
    expect(minMoney('5', '4.99')).toBe('4.99');
    expect(subtractMoney('0.30', '0.10')).toBe('0.20');
  });

  it('turns validated 2-dp numbers into exact strings', () => {
    expect(moneyFromNumber(0.1 + 0.2)).toBe('0.30');
    expect(moneyFromNumber(1999.99)).toBe('1999.99');
    expect(moneyFromNumber(5)).toBe('5.00');
  });
});
