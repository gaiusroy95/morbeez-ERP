import {
  depreciationForMonth,
  depreciationSchedule,
  disposalResult,
  emi,
  fuelEconomy,
  monthlyInterest,
  remainingSchedule,
  splitPayment,
} from './fleet-math';

const sl = { capitalizedOn: '2026-04-16', cost: '1200000.00', salvageValue: '120000.00', method: 'straight_line' as const, usefulLifeMonths: 96, annualRate: null };
const wdv = { capitalizedOn: '2026-04-01', cost: '1000000.00', salvageValue: '50000.00', method: 'written_down' as const, usefulLifeMonths: null, annualRate: '15.00' };

describe('depreciation', () => {
  it('straight line: (cost − salvage) / life a month, the first month for the days owned', () => {
    // 1,080,000 / 96 = 11,250 a month; April from the 16th = 15/30 → 5,625
    expect(depreciationForMonth(sl, '2026-04-01', '0')).toBe('5625.00');
    expect(depreciationForMonth(sl, '2026-05-01', '5625.00')).toBe('11250.00');
    expect(depreciationForMonth(sl, '2026-03-01', '0')).toBe('0.00');
  });

  it('never below salvage', () => {
    expect(depreciationForMonth(sl, '2034-04-01', '1075000.00')).toBe('5000.00');
    expect(depreciationForMonth(sl, '2034-05-01', '1080000.00')).toBe('0.00');
  });

  it('written-down value: book value × rate / 12, shrinking each month', () => {
    const s = depreciationSchedule(wdv, '2026-04-01', '2026-06-01', '0');
    // 1,000,000 × 15% / 12 = 12,500; then 987,500 × 1.25% = 12,343.75; then 975,156.25 × 1.25% = 12,189.45
    expect(s.map((m) => m.amount)).toEqual(['12500.00', '12343.75', '12189.45']);
    expect(s[2].accumulatedAfter).toBe('37033.20');
  });

  it('disposal: proceeds against net book value', () => {
    expect(disposalResult('1200000.00', '300000.00', '950000.00')).toEqual({ netBookValue: '900000.00', gainLoss: '50000.00' });
    expect(disposalResult('1200000.00', '300000.00', '0.00')).toEqual({ netBookValue: '900000.00', gainLoss: '-900000.00' });
  });
});

describe('loans', () => {
  it('EMI by the reducing-balance formula', () => {
    expect(emi('1000000.00', '9.00', 60)).toBe('20758.36');
    expect(emi('120000.00', '0.00', 12)).toBe('10000.00');
  });

  it('interest on the outstanding balance, to the paisa', () => {
    expect(monthlyInterest('1000000.00', '9.00')).toBe('7500.00');
    expect(monthlyInterest('333333.33', '10.50')).toBe('2916.67');
  });

  it('the schedule clears the balance exactly on its last installment', () => {
    const s = remainingSchedule({ annualRate: '9.00', emi: '20758.36', firstEmiOn: '2026-05-05' }, '1000000.00', 1);
    expect(s).toHaveLength(60);
    expect(s[0]).toMatchObject({ installmentNo: 1, dueOn: '2026-05-05', interest: '7500.00', principal: '13258.36' });
    expect(s[59].outstandingAfter).toBe('0.00');
    expect(s[59].dueOn).toBe('2031-04-05');
  });

  it('the tenure\'s last installment takes up the EMI\'s rounding', () => {
    // 16,606.68 is rounded down: without the adjustment a 61st installment of paise is left.
    const loose = remainingSchedule({ annualRate: '9.00', emi: '16606.68', firstEmiOn: '2026-08-10' }, '800000.00', 1);
    expect(loose).toHaveLength(61);
    const s = remainingSchedule({ annualRate: '9.00', emi: '16606.68', firstEmiOn: '2026-08-10', tenureMonths: 60 }, '800000.00', 1);
    expect(s).toHaveLength(60);
    expect(s[59].outstandingAfter).toBe('0.00');
    expect(Number(s[59].payment)).toBeGreaterThan(16606.68);
    expect(Number(s[59].payment)).toBeLessThan(16607);
  });

  it('a payment pays the month\'s interest first, then principal; overpaying is flagged', () => {
    expect(splitPayment('1000000.00', '9.00', '20758.36')).toEqual({ interest: '7500.00', principal: '13258.36', excess: '0.00' });
    expect(splitPayment('5000.00', '12.00', '6000.00')).toEqual({ interest: '50.00', principal: '5000.00', excess: '950.00' });
  });
});

describe('fuel economy', () => {
  it('distance from odometer readings, over the fuel burnt after the first reading', () => {
    const r = fuelEconomy([
      { filledOn: '2026-09-01', litres: '50', amount: '4500', odometerKm: 10000 },
      { filledOn: '2026-09-08', litres: '40', amount: '3600', odometerKm: 10360 },
      { filledOn: '2026-09-15', litres: '45.5', amount: '4100', odometerKm: 10770 },
    ]);
    expect(r).toEqual({ km: 770, kmPerLitre: '9.01' }); // 770 / 85.5
  });

  it('nothing to say with fewer than two readings', () => {
    expect(fuelEconomy([{ filledOn: '2026-09-01', litres: '50', amount: '4500', odometerKm: null }])).toEqual({ km: null, kmPerLitre: null });
  });
});
