import { measureLine } from './measures';

describe('measureLine', () => {
  it('live birds: the customer weight settles the sale; the difference is shrinkage', () => {
    // The client's example: farm 500 kg, customer 490 kg → 10 kg, 2%.
    const m = measureLine({ kind: 'weighment', dispatched: '500.000', entered: 490, tolerancePct: '2.00' });
    expect(m).toEqual({
      kind: 'weighment',
      dispatched: '500.000',
      settled: '490.000',
      loss: '10.000',
      lossPct: '2.00',
      tolerancePct: '2.00',
      withinTolerance: true,
    });
  });

  it('shrinkage above the tolerance is an exception', () => {
    const m = measureLine({ kind: 'weighment', dispatched: '500.000', entered: 485.5, tolerancePct: '2.00' });
    expect(m.loss).toBe('14.500');
    expect(m.lossPct).toBe('2.90');
    expect(m.withinTolerance).toBe(false);
  });

  it("a customer scale reading heavier is a negative loss, never an exception", () => {
    const m = measureLine({ kind: 'weighment', dispatched: '100.000', entered: 100.4, tolerancePct: '0.00' });
    expect(m.settled).toBe('100.400');
    expect(m.loss).toBe('-0.400');
    expect(m.lossPct).toBe('-0.40');
    expect(m.withinTolerance).toBe(true);
  });

  it('eggs: broken ones come off what is invoiced', () => {
    const m = measureLine({ kind: 'breakage', dispatched: '300', entered: 6, tolerancePct: '1.00' });
    expect(m.settled).toBe('294.000');
    expect(m.loss).toBe('6.000');
    expect(m.lossPct).toBe('2.00');
    expect(m.withinTolerance).toBe(false);
  });

  it('rounds the percentage half up to hundredths', () => {
    // 1 of 3 = 33.333…%; 1 of 8 = 12.5%; 1 of 600 = 0.1666…% → 0.17
    expect(measureLine({ kind: 'breakage', dispatched: '3', entered: 1, tolerancePct: '50' }).lossPct).toBe('33.33');
    expect(measureLine({ kind: 'breakage', dispatched: '8', entered: 1, tolerancePct: '50' }).lossPct).toBe('12.50');
    expect(measureLine({ kind: 'breakage', dispatched: '600', entered: 1, tolerancePct: '50' }).lossPct).toBe('0.17');
  });

  it('refuses more broken than dispatched, and negative entries', () => {
    expect(() => measureLine({ kind: 'breakage', dispatched: '30', entered: 31, tolerancePct: '1' })).toThrow(/More broke/);
    expect(() => measureLine({ kind: 'weighment', dispatched: '30', entered: -1, tolerancePct: '1' })).toThrow(/never negative/);
  });
});
