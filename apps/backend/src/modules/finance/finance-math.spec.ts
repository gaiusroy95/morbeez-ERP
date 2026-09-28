import { addDays, allocateInOrder, daysBetween, financeChargeAmount, laterDate } from './finance-math';
import { compareMoney, minMoney, moneyFromNumber, subtractMoney, sumMoney } from '../../common/money';

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

describe('financeChargeAmount', () => {
  it.each([
    // principal, % per 30 days, days, expected
    ['10000.00', '2.00', 30, '200.00'],
    ['10000.00', '2.00', 15, '100.00'],
    ['10000.00', '1.50', 1, '5.00'],
    ['12345.67', '1.75', 17, '122.43'], // 12345.67 × 0.0175 × 17/30 = 122.4279…
  ])('%s at %s%% for %i days', (principal, rate, days, expected) => {
    expect(financeChargeAmount(principal, rate, days)).toBe(expected);
  });

  it('rounds half up to the paisa', () => {
    // 100.00 × 1% × 15/30 = 0.50 exactly; 1.00 × 1.5% × 1/30 = 0.0005 → 0.00; 3.00 × 1% × 15/30 = 0.015 → 0.02
    expect(financeChargeAmount('100.00', '1.00', 15)).toBe('0.50');
    expect(financeChargeAmount('1.00', '1.50', 1)).toBe('0.00');
    expect(financeChargeAmount('3.00', '1.00', 15)).toBe('0.02');
  });

  it('charges nothing for no days, no rate, or no principal', () => {
    expect(financeChargeAmount('5000.00', '2.00', 0)).toBe('0.00');
    expect(financeChargeAmount('5000.00', '0.00', 30)).toBe('0.00');
    expect(financeChargeAmount('0.00', '2.00', 30)).toBe('0.00');
    expect(financeChargeAmount('5000.00', '2.00', -3)).toBe('0.00');
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
