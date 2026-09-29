import { computeEarnings, EarningsInput, WorkDay } from './payroll-math';
import { MinimumWageRate, PayRate } from './entities/payroll.entity';

const rate = (payBasis: PayRate['payBasis'], r: string, from = '2026-01-01', to: string | null = null, unitLabel: string | null = null): PayRate => ({
  id: `r-${payBasis}-${from}`,
  employeeId: 'e1',
  payBasis,
  rate: r,
  unitLabel: payBasis === 'piece' ? unitLabel ?? 'crate' : null,
  effectiveFrom: from,
  effectiveTo: to,
});
const day = (date: string, over: Partial<WorkDay> = {}): WorkDay => ({ date, status: 'completed', kind: 'warehouse', hours: null, units: null, ...over });
const minWage = (dailyRate: string, from = '2026-04-01', to: string | null = null): MinimumWageRate => ({
  id: `mw-${from}`,
  stateCode: '27',
  skillCategory: 'unskilled',
  dailyRate,
  effectiveFrom: from,
  effectiveTo: to,
  source: null,
});

const base = (over: Partial<EarningsInput>): EarningsInput => ({
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  roleType: 'warehouse',
  skillCategory: 'unskilled',
  stateCode: '27',
  joinedOn: null,
  leftOn: null,
  rates: [],
  work: [],
  incentiveRules: [],
  minimumWages: [],
  minWagePolicy: 'top_up',
  adjustments: [],
  advances: [],
  maxAdvanceRecovery: null,
  ...over,
});

describe('computeEarnings', () => {
  it('daily wage: one day per date with completed work, however many assignments', () => {
    const r = computeEarnings(
      base({
        rates: [rate('daily', '600.00')],
        work: [day('2026-09-02'), day('2026-09-02', { kind: 'loading' }), day('2026-09-03'), day('2026-09-04', { status: 'absent' })],
      }),
    );
    expect(r.lines).toEqual([expect.objectContaining({ kind: 'basic', quantity: '2.000', rate: '600.00', amount: '1200.00' })]);
    expect(r).toMatchObject({ daysWorked: 2, gross: '1200.00', net: '1200.00' });
  });

  it('a rate change mid-period pays each day at the rate in force that day', () => {
    const r = computeEarnings(
      base({
        rates: [rate('daily', '600.00', '2026-01-01', '2026-09-14'), rate('daily', '650.00', '2026-09-15')],
        work: [day('2026-09-10'), day('2026-09-15'), day('2026-09-16')],
      }),
    );
    expect(r.lines.map((l) => [l.rate, l.quantity, l.amount])).toEqual([
      ['600.00', '1.000', '600.00'],
      ['650.00', '2.000', '1300.00'],
    ]);
  });

  it('monthly salary: calendar-day proration from joining, less days marked absent', () => {
    const r = computeEarnings(
      base({
        rates: [rate('monthly', '18000.00')],
        joinedOn: '2026-09-11', // 20 days of September
        work: [day('2026-09-12', { status: 'absent' })], // one day loss of pay
      }),
    );
    // 18000 × 19/30 = 11400.00
    expect(r.lines).toEqual([expect.objectContaining({ description: 'Salary, Sep 2026 — 19 of 30 days', amount: '11400.00' })]);
    expect(r.daysWorked).toBe(19);
  });

  it('monthly salary across two months prorates each by its own length', () => {
    const r = computeEarnings(base({ periodStart: '2026-09-16', periodEnd: '2026-10-15', rates: [rate('monthly', '31000.00')] }));
    // Sep: 31000 × 15/30 = 15500.00; Oct: 31000 × 15/31 = 15000.00
    expect(r.lines.map((l) => l.amount)).toEqual(['15500.00', '15000.00']);
  });

  it('hourly and piece rates multiply exactly', () => {
    const hourly = computeEarnings(base({ rates: [rate('hourly', '85.50')], work: [day('2026-09-02', { hours: '7.50' }), day('2026-09-03', { hours: '4.25' })] }));
    expect(hourly.lines[0]).toMatchObject({ quantity: '11.750', amount: '1004.63' }); // 11.75 × 85.50 = 1004.625 → half up
    const piece = computeEarnings(base({ rates: [rate('piece', '4.25')], work: [day('2026-09-02', { units: '120' }), day('2026-09-03', { units: '95.5' })] }));
    expect(piece.lines[0]).toMatchObject({ description: 'Piece rate — 215.500 crate', amount: '915.88' }); // 215.5 × 4.25 = 915.875
  });

  it('warns about unpaid work: no rate that day, or no hours for an hourly worker', () => {
    const r = computeEarnings(base({ rates: [rate('hourly', '80.00', '2026-09-05')], work: [day('2026-09-02', { hours: '8' }), day('2026-09-06')] }));
    expect(r.warnings).toEqual([
      'No pay rate in force on 2026-09-02 — that work isn\'t paid.',
      'Work on 2026-09-06 has no hours recorded — not paid by the hour.',
    ]);
    expect(r.net).toBe('0.00');
  });

  describe('minimum wage', () => {
    it('tops up basic pay to the daily minimum for the days worked', () => {
      const r = computeEarnings(base({ rates: [rate('daily', '400.00')], work: [day('2026-09-02'), day('2026-09-03')], minimumWages: [minWage('450.50')] }));
      expect(r.lines[1]).toMatchObject({ kind: 'minimum_wage_topup', amount: '101.00' }); // 901.00 − 800.00
      expect(r.gross).toBe('901.00');
    });

    it('checks piece-rate earnings against the day, and an hourly short day pro rata', () => {
      const piece = computeEarnings(base({ rates: [rate('piece', '2.00')], work: [day('2026-09-02', { units: '100' })], minimumWages: [minWage('500.00')] }));
      expect(piece.lines.find((l) => l.kind === 'minimum_wage_topup')?.amount).toBe('300.00');
      const shortDay = computeEarnings(base({ rates: [rate('hourly', '50.00')], work: [day('2026-09-02', { hours: '4' })], minimumWages: [minWage('480.00')] }));
      // 4 h × 50 = 200; floor 480 × 4/8 = 240 → top-up 40
      expect(shortDay.lines.find((l) => l.kind === 'minimum_wage_topup')?.amount).toBe('40.00');
    });

    it('uses the rate in force each day, only for the worker\'s state and skill', () => {
      const r = computeEarnings(
        base({
          rates: [rate('daily', '300.00')],
          work: [day('2026-09-29'), day('2026-10-01')],
          periodEnd: '2026-10-31',
          minimumWages: [
            minWage('400.00', '2026-04-01', '2026-09-30'),
            minWage('420.00', '2026-10-01'),
            { ...minWage('999.00'), stateCode: '29' },
            { ...minWage('999.00'), skillCategory: 'skilled' },
          ],
        }),
      );
      expect(r.lines.find((l) => l.kind === 'minimum_wage_topup')?.amount).toBe('220.00'); // 820 − 600
    });

    it('with the "warn" policy, flags the shortfall without paying it', () => {
      const r = computeEarnings(base({ rates: [rate('daily', '400.00')], work: [day('2026-09-02')], minimumWages: [minWage('450.00')], minWagePolicy: 'warn' }));
      expect(r.lines.some((l) => l.kind === 'minimum_wage_topup')).toBe(false);
      expect(r.warnings[0]).toMatch(/50\.00 below the minimum wage/);
    });

    it('warns when no state or no rate is known — never silently passes', () => {
      expect(computeEarnings(base({ stateCode: null, rates: [rate('daily', '400.00')], work: [day('2026-09-02')] })).warnings[0]).toMatch(/No work state/);
      expect(computeEarnings(base({ rates: [rate('daily', '400.00')], work: [day('2026-09-02')] })).warnings[0]).toMatch(/No minimum wage entered for state 27/);
    });
  });

  describe('incentives', () => {
    const rule = (over: object) => ({ id: 'inc', name: 'Trip bonus', roleType: null, basis: 'per_trip', threshold: '0', amount: '100.00', effectiveFrom: '2026-01-01', effectiveTo: null, ...over }) as never;

    it('per trip above a threshold, per unit above a threshold, attendance bonus', () => {
      const work = [
        ...['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map((d) => day(d, { kind: 'trip', units: '40' })),
      ];
      const r = computeEarnings(
        base({
          roleType: 'driver',
          rates: [rate('daily', '700.00')],
          work,
          incentiveRules: [
            rule({ threshold: '2' }),
            rule({ id: 'u', name: 'Crates bonus', basis: 'per_unit', threshold: '100', amount: '1.50' }),
            rule({ id: 'a', name: 'Full attendance', basis: 'attendance', threshold: '4', amount: '500.00' }),
            rule({ id: 'x', name: 'Warehouse only', roleType: 'warehouse' }),
            rule({ id: 'old', name: 'Expired', effectiveTo: '2026-08-31' }),
          ],
        }),
      );
      expect(r.lines.filter((l) => l.kind === 'incentive').map((l) => [l.description, l.amount])).toEqual([
        ['Trip bonus — 2 trip(s) above 2', '200.00'],
        ['Crates bonus — 60.000 units above 100', '90.00'],
        ['Full attendance — 4 days worked', '500.00'],
      ]);
      expect(r.gross).toBe('3590.00'); // 2800 + 200 + 90 + 500
    });

    it('incentives never count toward the minimum wage', () => {
      const r = computeEarnings(
        base({
          rates: [rate('daily', '400.00')],
          work: [day('2026-09-02', { kind: 'trip' })],
          incentiveRules: [rule({ amount: '500.00' })],
          minimumWages: [minWage('450.00')],
        }),
      );
      expect(r.lines.find((l) => l.kind === 'minimum_wage_topup')?.amount).toBe('50.00');
    });
  });

  describe('deductions', () => {
    it('recovers advances oldest first, never below zero net, within a cap', () => {
      const advances = [
        { id: 'a1', paidOn: '2026-08-01', outstanding: '700.00' },
        { id: 'a2', paidOn: '2026-08-20', outstanding: '1000.00' },
      ];
      const all = computeEarnings(base({ rates: [rate('daily', '500.00')], work: [day('2026-09-02'), day('2026-09-03')], advances }));
      expect(all.lines.filter((l) => l.kind === 'advance_recovery').map((l) => [l.advanceId, l.amount])).toEqual([
        ['a1', '-700.00'],
        ['a2', '-300.00'],
      ]);
      expect(all).toMatchObject({ gross: '1000.00', deductions: '1000.00', net: '0.00' });

      const capped = computeEarnings(base({ rates: [rate('daily', '500.00')], work: [day('2026-09-02'), day('2026-09-03')], advances, maxAdvanceRecovery: '250.00' }));
      expect(capped).toMatchObject({ deductions: '250.00', net: '750.00' });
    });

    it('adjustments add to gross or to deductions by sign', () => {
      const r = computeEarnings(
        base({
          rates: [rate('daily', '500.00')],
          work: [day('2026-09-02')],
          adjustments: [
            { description: 'Festival bonus', amount: '250.00' },
            { description: 'Damaged crate', amount: '-80.00' },
          ],
        }),
      );
      expect(r).toMatchObject({ gross: '750.00', deductions: '80.00', net: '670.00' });
    });
  });
});
