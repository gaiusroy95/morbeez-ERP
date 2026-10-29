import { qrMatches, shortfallsOf, shortfallTextOf } from './delivery-stop';

describe('qrMatches — the customer QR at the door (driver app D3)', () => {
  it('reads the printed text or the bare token, in any case, with spaces around', () => {
    expect(qrMatches('MORBEEZ:C:ABCD1234EF567890', 'ABCD1234EF567890')).toBe(true);
    expect(qrMatches('  morbeez:c:abcd1234ef567890 ', 'ABCD1234EF567890')).toBe(true);
    expect(qrMatches('abcd1234ef567890', 'ABCD1234EF567890')).toBe(true);
  });

  it("refuses another shop's QR, and an empty one", () => {
    expect(qrMatches('MORBEEZ:C:FFFF0000FFFF0000', 'ABCD1234EF567890')).toBe(false);
    expect(qrMatches('MORBEEZ:C:', 'ABCD1234EF567890')).toBe(false);
    expect(qrMatches('', '')).toBe(false);
  });
});

describe('shortfallsOf', () => {
  const lines = [
    { id: 'l-tomato', productName: 'Tomato', quantity: '350.000' },
    { id: 'l-onion', productName: 'Onion', quantity: '100.000' },
  ];

  it('records each line delivered short, with its reason and note; lines delivered in full are left out', () => {
    const out = shortfallsOf(
      lines,
      new Map([['l-tomato', '300.000'], ['l-onion', '100.000']]),
      [{ orderLineId: 'l-tomato', shortReason: 'damaged', shortNote: ' crushed ' }],
      true,
    );
    expect(out).toEqual([{ orderLineId: 'l-tomato', ordered: '350.000', delivered: '300.000', reason: 'damaged', note: 'crushed' }]);
  });

  it('a line not entered was delivered as ordered', () => {
    expect(shortfallsOf(lines, new Map(), [], true)).toEqual([]);
  });

  it("with the driver's checklist a short line needs its reason; without it, it's just not recorded", () => {
    const delivered = new Map([['l-onion', '0.000']]);
    expect(() => shortfallsOf(lines, delivered, [], true)).toThrow('Say why less Onion was delivered than ordered');
    expect(shortfallsOf(lines, delivered, [], false)).toEqual([]);
  });

  it('reads each reason for the owner', () => {
    expect(shortfallTextOf('not_enough_on_vehicle')).toBe('not enough on the vehicle');
  });
});
