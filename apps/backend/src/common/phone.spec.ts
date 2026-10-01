import { formatIndianMobile, normalizeIndianMobile } from './phone';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9822011111', '+919822011111'],
    ['98220 11111', '+919822011111'],
    ['+91 98220-11111', '+919822011111'],
    ['09822011111', '+919822011111'],
    ['919822011111', '+919822011111'],
    ['0091 9822011111', '+919822011111'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each(['5822011111', '982201111', '98220111112', '+1 4155550100', 'owner@example.com', ''])(
    'rejects %s',
    (input) => {
      expect(normalizeIndianMobile(input)).toBeNull();
    },
  );

  it('formats for people', () => {
    expect(formatIndianMobile('+919822011111')).toBe('98220 11111');
  });
});
