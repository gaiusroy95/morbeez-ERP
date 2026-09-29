import { addDays, backtest, buyQuantity, DailySeries, forecastDemand } from './forecast';
import { suggestPrice, worthSuggesting } from './pricing';
import { bestOrder, km, planLoads, tourKm } from './routing';
import { highOutliers, median, robustZ } from './anomaly';
import { adviseTerms, creditCost, profit } from './profitability';

describe('forecast', () => {
  // Tuesdays 2026-09-01..22 sold 200, 220, 180, 212; other days 100.
  const series: DailySeries = new Map();
  for (let i = 0; i < 57; i++) series.set(addDays('2026-08-03', i), 100); // through 2026-09-28

  [['2026-09-01', 200], ['2026-09-08', 220], ['2026-09-15', 180], ['2026-09-22', 212]].forEach(([d, q]) => series.set(d as string, q as number));

  it('same weekday over 4 weeks, times the trend', () => {
    const f = forecastDemand(series, '2026-09-29', '2026-08-03');
    expect(f.sameWeekday.map((d) => d.qty)).toEqual([212, 180, 220, 200]);
    expect(f.weekdayMean).toBe(203);
    // last 14 days 1,592 kg vs 1,620 the 14 before (the two latest Tuesdays sold 28 kg less)
    expect(f.trend).toBe(0.98);
    expect(f.demand).toBe(199.491); // 203 × 1592/1620, unrounded trend
    expect(f.confidence).toBe('solid');
    expect(f.low).toBeLessThan(f.demand);
  });

  it('under six weeks of history is an early estimate', () => {
    expect(forecastDemand(series, '2026-09-29', '2026-09-01').confidence).toBe('early_estimate');
  });

  it('the trend is clamped to 0.8–1.25', () => {
    const up: DailySeries = new Map();
    for (let i = 0; i < 28; i++) up.set(addDays('2026-09-01', i), i < 14 ? 10 : 100);
    expect(forecastDemand(up, '2026-09-29', '2026-08-01').trend).toBe(1.25);
  });

  it('buy: demand plus spoilage, less stock and inbound, never negative', () => {
    expect(buyQuantity(200, 0.1, 50, 30)).toBe(140);
    expect(buyQuantity(100, 0.1, 500, 0)).toBe(0);
    expect(buyQuantity(100, 0.9, 0, 0)).toBe(150); // spoilage capped at 50%
  });

  it('backtest: WAPE of the baseline over the last days', () => {
    const r = backtest(series, '2026-09-28', 14, '2026-08-03');
    expect(r.days).toBe(14);
    expect(r.wape).not.toBeNull();
    expect(r.wape!).toBeLessThan(0.2);
  });
});

describe('pricing', () => {
  const base = { unitCost: '20.00', basePrice: '24.00', realized: null, targetMarginPct: '20.00', maxMovePct: '15.00' };
  it('cost plus target margin, to the half rupee', () => {
    expect(suggestPrice(base)).toMatchObject({ price: '24.00', reason: 'margin' });
    expect(suggestPrice({ ...base, unitCost: '21.30' })).toMatchObject({ price: '25.50' }); // 25.56
  });
  it('kept inside what the market paid lately', () => {
    const s = suggestPrice({ ...base, unitCost: '20.00', realized: { low: '21.00', high: '23.00', average: '22.00', lines: 8 } });
    expect(s).toMatchObject({ price: '23.00', reason: 'market' });
  });
  it('moves at most the set step from today', () => {
    expect(suggestPrice({ ...base, basePrice: '18.00', unitCost: '30.00' }).price).toBe('30.00'); // step would stop at 20.70, but never below cost
    expect(suggestPrice({ ...base, basePrice: '20.00', unitCost: '21.00' }).price).toBe('23.00'); // 25.20 limited to 23.00
  });
  it('never below cost; a price below cost is always worth raising', () => {
    const s = suggestPrice({ ...base, basePrice: '18.00', unitCost: '30.00' });
    expect(s.reason).toBe('below_cost');
    expect(worthSuggesting(s, '18.00')).toBe(true);
  });
  it('not worth a tiny move', () => {
    expect(worthSuggesting(suggestPrice(base), '24.00')).toBe(false);
  });
});

describe('routing', () => {
  const depot = { lat: 18.52, lng: 73.85 };
  const east = { lat: 18.52, lng: 73.95 };
  const farEast = { lat: 18.52, lng: 74.05 };
  const west = { lat: 18.52, lng: 73.75 };
  it('distance with the road factor', () => {
    expect(Math.round(km(depot, east))).toBe(14); // ~10.5 km straight × 1.3
  });
  it('a zig-zag order is straightened', () => {
    const pts = [farEast, west, east];
    const o = bestOrder(depot, pts);
    expect(tourKm(depot, o.map((i) => pts[i]))).toBeLessThan(tourKm(depot, pts));
  });
  it('loads: cheapest vehicle first, by capacity, heavy orders left out', () => {
    const r = planLoads(depot, [
      { orderId: 'a', kg: 600, point: east },
      { orderId: 'b', kg: 500, point: farEast },
      { orderId: 'c', kg: 700, point: west },
      { orderId: 'd', kg: 5000, point: west },
    ], [
      { vehicleId: 'big', capacityKg: 1500, costPerKm: 22 },
      { vehicleId: 'small', capacityKg: 1000, costPerKm: 14 },
    ]);
    expect(r.unplaced).toEqual(['d']);
    expect(r.loads[0].vehicleId).toBe('small');
    expect(r.loads.flatMap((l) => l.orderIds).sort()).toEqual(['a', 'b', 'c']);
    expect(r.loads.every((l) => l.km !== null)).toBe(true);
  });
});

describe('anomaly', () => {
  it('robust z ignores the outlier it is judging', () => {
    const xs = [100, 110, 95, 105, 98, 102, 900];
    expect(median(xs)).toBe(102);
    expect(robustZ(900, xs)).toBeGreaterThan(50);
    expect(highOutliers(xs, (x) => x, 3.5, 5).map((r) => r.item)).toEqual([900]);
    expect(highOutliers([1, 2, 900], (x) => x, 3.5, 5)).toEqual([]); // too few to judge
  });
});

describe('profitability', () => {
  const f = {
    customerId: 'c', invoices: 6, revenue: '10000.00', cogs: '8500.00', deliveryCost: '900.00', financeChargeIncome: '0.00',
    crateRecoveries: '0.00', crateLossesAbsorbed: '180.00', receivableRupeeDays: '300000.00', averageDaysToPay: 30, paymentTermsDays: 7,
  };
  it('credit cost: rupee-days at the annual rate', () => {
    expect(creditCost('365000.00', '12.00')).toBe('120.00');
  });
  it('contribution after goods, delivery, credit and crates', () => {
    const p = profit(f, '12.00');
    // 10000 − 8500 − 900 − 98.63 − 180
    expect(p.creditCost).toBe('98.63');
    expect(p.contribution).toBe('321.37');
    expect(p.grossMarginPct).toBe(15);
    expect(p.deliveryPct).toBe(9);
  });
  it('advice: the lever with most money behind it', () => {
    expect(adviseTerms(profit(f, '12.00'))?.lever).toBe('order_size');
    expect(adviseTerms(profit({ ...f, deliveryCost: '100.00', receivableRupeeDays: '9000000.00' }, '12.00'))?.lever).toBe('payment_terms');
  });
});
