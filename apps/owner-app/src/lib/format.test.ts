import { describe, expect, it } from 'vitest';
import { computeDelta, formatAmount, formatDate, formatDateTime, formatMoney, formatQuantity } from './format';

// Owners read money in lakhs and crores and dates in their own time zone;
// getting either wrong makes a correct figure look wrong (Testing Strategy UT.4).
describe('money', () => {
  it('groups by lakh and crore', () => {
    expect(formatMoney('1234567', 'INR')).toBe('₹12,34,567');
    expect(formatAmount('125000.5')).toBe('1,25,000.50');
  });

  it('statement style shows negatives in parentheses', () => {
    expect(formatAmount('-1250')).toBe('(1,250.00)');
  });
});

describe('quantities', () => {
  it('keeps up to three decimals and the unit', () => {
    expect(formatQuantity('1250.500', 'kg')).toBe('1,250.5 kg');
    expect(formatQuantity(null)).toBe('—');
  });
});

describe('dates', () => {
  it('a tenant-local date never shifts, whatever the browser zone', () => {
    expect(formatDate('2026-04-01')).toMatch(/^1 Apr 2026$/);
  });

  it('an instant is shown in the tenant zone: 22:00 UTC is the next morning in India', () => {
    expect(formatDateTime('2026-09-29T22:00:00Z', 'Asia/Kolkata')).toMatch(/^30 Sept?, 3:30\s?am$/i);
  });
});

describe('change against the previous period', () => {
  it('describes up, down and no change', () => {
    expect(computeDelta('110', '100')).toEqual({ direction: 'up', label: '+10%' });
    expect(computeDelta('95', '100')).toEqual({ direction: 'down', label: '−5.0%' });
    expect(computeDelta('100.2', '100')).toEqual({ direction: 'flat', label: 'No change' });
  });

  it('nothing to compare against', () => {
    expect(computeDelta('5', null)).toBeNull();
    expect(computeDelta('5', '0')).toEqual({ direction: 'up', label: 'New this period' });
  });
});
