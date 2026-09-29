import { judgeLine, lineValue, planDraw, resolveBand, unitCostOf } from './spot-math';

const defaults = { floorPct: '10.00', ceilingPct: '25.00' };

describe('resolveBand', () => {
  it("the product's own band wins", () => {
    expect(resolveBand({ minPrice: '28.00', maxPrice: null }, '32.00', defaults)).toEqual({ source: 'band', min: '28.00', max: null });
  });
  it('otherwise the default either side of the base price', () => {
    expect(resolveBand(null, '32.00', defaults)).toEqual({ source: 'default', min: '28.80', max: '40.00' });
  });
  it('no band and no base price: none', () => {
    expect(resolveBand(null, null, defaults)).toEqual({ source: 'none', min: null, max: null });
  });
});

describe('judgeLine', () => {
  const band = { source: 'band' as const, min: '28.00', max: '40.00' };
  it('inside the band, above cost: no exception', () => {
    expect(judgeLine({ quantity: '10', unitPrice: '30.00' }, band, '20.00')).toEqual({ exception: null, value: '0.00' });
  });
  it('under the floor: the shortfall across the quantity', () => {
    expect(judgeLine({ quantity: '12.5', unitPrice: '25.00' }, band, '20.00')).toEqual({ exception: 'below_band', value: '37.50' });
  });
  it('over the ceiling', () => {
    expect(judgeLine({ quantity: '2', unitPrice: '45.00' }, band, '20.00')).toEqual({ exception: 'above_band', value: '10.00' });
  });
  it('inside the band but under cost: below cost', () => {
    expect(judgeLine({ quantity: '10', unitPrice: '29.00' }, band, '31.00')).toEqual({ exception: 'below_cost', value: '20.00' });
  });
  it('the larger of two exceptions applies', () => {
    expect(judgeLine({ quantity: '10', unitPrice: '20.00' }, band, '30.00')).toEqual({ exception: 'below_cost', value: '100.00' });
  });
  it('no band: the whole value', () => {
    expect(judgeLine({ quantity: '3', unitPrice: '15.00' }, { source: 'none', min: null, max: null }, null)).toEqual({ exception: 'no_band', value: '45.00' });
  });
});

describe('planDraw', () => {
  const lots = [
    { lotId: 'b', quantity: '40.000', unitCost: '22.00', receivedAt: '2026-09-20T00:00:00Z' },
    { lotId: 'a', quantity: '15.500', unitCost: '20.00', receivedAt: '2026-09-18T00:00:00Z' },
  ];
  it('oldest lot first, then the next, at each lot\'s own cost', () => {
    expect(planDraw(lots, '20')).toEqual({
      draws: [
        { lotId: 'a', quantity: '15.500', unitCost: '20.00' },
        { lotId: 'b', quantity: '4.500', unitCost: '22.00' },
      ],
      cost: '409.00', // 310 + 99
    });
    expect(unitCostOf('409.00', '20')).toBe('20.45');
  });
  it('not enough on the vehicle: null', () => {
    expect(planDraw(lots, '56')).toBeNull();
  });
  it('line value to the paisa', () => {
    expect(lineValue('2.333', '30.00')).toBe('69.99');
  });
});
