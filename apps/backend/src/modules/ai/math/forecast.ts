// Tomorrow's buying (AI System REC table; Constitution VIII.4 baseline):
// the same weekday over the last few weeks, times the recent trend, less
// what's already in stock or on its way, grossed up by what usually spoils.
// Pure. Quantities are statistics here, rounded to the gram at the edge.

export type Confidence = 'solid' | 'rough_guide' | 'early_estimate';

/** A day's sold quantity by ISO date (YYYY-MM-DD). Missing days sold nothing. */
export type DailySeries = Map<string, number>;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export interface DemandForecast {
  targetDate: string;
  sameWeekday: { date: string; qty: number }[];
  weekdayMean: number;
  trend: number; // last 14 days over the 14 before, clamped
  demand: number;
  low: number;
  high: number;
  confidence: Confidence;
}

/**
 * Demand on `targetDate` from sales strictly before it. `firstSaleDate`
 * bounds how much history counts: under six weeks of it, the forecast is
 * an early estimate whatever its spread.
 */
export function forecastDemand(series: DailySeries, targetDate: string, firstSaleDate: string | null, weeks = 4): DemandForecast {
  const sameWeekday = Array.from({ length: weeks }, (_, i) => {
    const date = addDays(targetDate, -7 * (i + 1));
    return { date, qty: series.get(date) ?? 0 };
  });
  const values = sameWeekday.map((d) => d.qty);
  const weekdayMean = mean(values);
  const window = (from: number, to: number) => sum(Array.from({ length: to - from }, (_, i) => series.get(addDays(targetDate, -(from + i + 1))) ?? 0));
  const recent = window(0, 14);
  const prior = window(14, 28);
  const trend = prior > 0 ? Math.min(1.25, Math.max(0.8, recent / prior)) : 1;
  const demand = weekdayMean * trend;
  const spread = sd(values) * trend;
  const historyDays = firstSaleDate ? (Date.parse(targetDate) - Date.parse(firstSaleDate)) / 86_400_000 : 0;
  const cv = demand > 0 ? spread / demand : Infinity;
  const confidence: Confidence = historyDays < 42 || demand === 0 ? 'early_estimate' : cv <= 0.25 ? 'solid' : 'rough_guide';
  return {
    targetDate,
    sameWeekday,
    weekdayMean: round3(weekdayMean),
    trend: Math.round(trend * 100) / 100,
    demand: round3(demand),
    low: round3(Math.max(0, demand - spread)),
    high: round3(demand + spread),
    confidence,
  };
}

/** What to buy: demand grossed up for spoilage, less free stock and inbound. Never negative. */
export function buyQuantity(demand: number, shrinkRate: number, freeStock: number, inbound: number): number {
  const gross = demand * (1 + Math.min(Math.max(shrinkRate, 0), 0.5));
  return round3(Math.max(0, gross - freeStock - inbound));
}

/**
 * Rolling-origin backtest (AI System EVAL.1): for each of the last `days`
 * days, forecast it from what came before and compare with what sold.
 * WAPE = Σ|forecast − actual| / Σ actual; bias = Σ(forecast − actual) / Σ actual.
 */
export function backtest(series: DailySeries, lastDate: string, days: number, firstSaleDate: string | null): { wape: number | null; bias: number | null; days: number } {
  let err = 0;
  let signed = 0;
  let actualSum = 0;
  let n = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(lastDate, -i);
    const f = forecastDemand(series, date, firstSaleDate).demand;
    const a = series.get(date) ?? 0;
    err += Math.abs(f - a);
    signed += f - a;
    actualSum += a;
    n++;
  }
  if (actualSum === 0) return { wape: null, bias: null, days: n };
  return { wape: Math.round((err / actualSum) * 1000) / 1000, bias: Math.round((signed / actualSum) * 1000) / 1000, days: n };
}
