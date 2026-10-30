import { fuelProblemOf, odometerProblemOf } from './expenses';

describe('fuelProblemOf (driver app D6)', () => {
  it('has nothing to say about an expense without pump details', () => {
    expect(fuelProblemOf({ category: 'toll', amount: 120 })).toBeNull();
    expect(fuelProblemOf({ category: 'fuel', amount: 500 })).toBeNull();
  });

  it('keeps pump details to fuel', () => {
    expect(fuelProblemOf({ category: 'parking', amount: 50, odometerKm: 48620 })).toMatch(/Only a fuel expense/);
  });

  it('takes litres and the rate together', () => {
    expect(fuelProblemOf({ category: 'fuel', amount: 6049.5, litres: 65.4 })).toMatch(/go together/);
    expect(fuelProblemOf({ category: 'fuel', amount: 6049.5, ratePerLitre: 92.5 })).toMatch(/go together/);
  });

  it('accepts a bill within a rupee of litres × rate — the pump rounds', () => {
    expect(fuelProblemOf({ category: 'fuel', amount: 6049.5, litres: 65.4, ratePerLitre: 92.5 })).toBeNull();
    expect(fuelProblemOf({ category: 'fuel', amount: 6050, litres: 65.4, ratePerLitre: 92.5 })).toBeNull();
    expect(fuelProblemOf({ category: 'fuel', amount: 6050.5, litres: 65.4, ratePerLitre: 92.5 })).toBeNull();
  });

  it('refuses a bill that doesn’t match', () => {
    expect(fuelProblemOf({ category: 'fuel', amount: 6052.5, litres: 65.4, ratePerLitre: 92.5 })).toBe(
      "₹6052.50 doesn't match 65.4 L at ₹92.50 a litre (₹6049.50)",
    );
  });
});

describe('odometerProblemOf (driver app D6)', () => {
  const trip = { openingKm: '48600.0', closingKm: null };

  it('accepts a reading at or after the trip set off', () => {
    expect(odometerProblemOf(48600, trip, null)).toBeNull();
    expect(odometerProblemOf(48620, trip, 48610)).toBeNull();
  });

  it('never below the opening KM', () => {
    expect(odometerProblemOf(48599, trip, null)).toMatch(/48600 km when the trip set off/);
  });

  it('never below an earlier fill on the trip', () => {
    expect(odometerProblemOf(48615, trip, 48620)).toMatch(/earlier fill on this trip read 48620 km/);
  });

  it('never past what Return read', () => {
    expect(odometerProblemOf(48800, { openingKm: '48600.0', closingKm: '48792.0' }, null)).toMatch(/Return read 48792 km/);
  });

  it('a trip that set off without an opening KM takes any reading', () => {
    expect(odometerProblemOf(10, { openingKm: null, closingKm: null }, null)).toBeNull();
  });
});
