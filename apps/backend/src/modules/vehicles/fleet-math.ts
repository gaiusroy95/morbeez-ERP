// Vehicle economics arithmetic, pure: depreciation month by month (Accounting
// Engine VEH.2), net book value (VEH.3), the gain or loss on disposal
// (VEH.4), loan EMIs and their interest/principal split, and fuel economy.
// Money in integer paise throughout, never floats — except the one
// closed-form EMI quote, rounded to the paisa at once.

import { fromCents, toCents } from '../../common/money';

export interface AssetTerms {
  capitalizedOn: string; // YYYY-MM-DD
  cost: string;
  salvageValue: string;
  method: 'straight_line' | 'written_down';
  usefulLifeMonths: number | null;
  annualRate: string | null; // percent, WDV
}

const half = (num: bigint, den: bigint) => (num * 2n + den) / (den * 2n); // non-negative, half-up

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Percent with 2 dp ("15.00") → basis points. */
function bps(rate: string): bigint {
  const [w, f = ''] = rate.split('.');
  return BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
}

/**
 * One month's depreciation. The month of capitalisation is charged only for
 * the days owned; nothing ever takes book value below salvage.
 */
export function depreciationForMonth(asset: AssetTerms, month: string, accumulatedBefore: string): string {
  const cost = toCents(asset.cost);
  const salvage = toCents(asset.salvageValue);
  const accumulated = toCents(accumulatedBefore);
  const room = cost - salvage - accumulated;
  if (room <= 0n || month < firstOfMonth(asset.capitalizedOn)) return '0.00';

  // Share of the month owned: all of it, except the first.
  let num = 1n;
  let den = 1n;
  if (month === firstOfMonth(asset.capitalizedOn)) {
    const dim = daysInMonth(month);
    num = BigInt(dim - Number(asset.capitalizedOn.slice(8, 10)) + 1);
    den = BigInt(dim);
  }

  let amount: bigint;
  if (asset.method === 'straight_line') {
    amount = half((cost - salvage) * num, BigInt(asset.usefulLifeMonths!) * den);
  } else {
    // Book value × annual rate / 12.
    amount = half((cost - accumulated) * bps(asset.annualRate!) * num, 10_000n * 12n * den);
  }
  return fromCents(amount < room ? amount : room);
}

export interface MonthCharge {
  month: string;
  amount: string;
  accumulatedAfter: string;
}

/** Every month's charge from `fromMonth` through `throughMonth`, carrying the accumulated total. */
export function depreciationSchedule(asset: AssetTerms, fromMonth: string, throughMonth: string, accumulatedBefore: string): MonthCharge[] {
  const out: MonthCharge[] = [];
  let accumulated = toCents(accumulatedBefore);
  for (let m = fromMonth; m <= throughMonth; m = addMonths(m, 1)) {
    const amount = depreciationForMonth(asset, m, fromCents(accumulated));
    accumulated += toCents(amount);
    out.push({ month: m, amount, accumulatedAfter: fromCents(accumulated) });
  }
  return out;
}

/** VEH.3/4: net book value, and proceeds against it (+ gain, − loss). */
export function disposalResult(cost: string, accumulated: string, proceeds: string): { netBookValue: string; gainLoss: string } {
  const nbv = toCents(cost) - toCents(accumulated);
  return { netBookValue: fromCents(nbv), gainLoss: fromCents(toCents(proceeds) - nbv) };
}

// ---- Loans ----

/** The standard reducing-balance EMI, to the paisa. */
export function emi(principal: string, annualRate: string, months: number): string {
  const p = Number(principal);
  const r = Number(annualRate) / 1200;
  const value = r === 0 ? p / months : (p * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  return fromCents(BigInt(Math.round(value * 100)));
}

/** A month's interest on what's outstanding, half-up to the paisa. */
export function monthlyInterest(outstanding: string, annualRate: string): string {
  return fromCents(half(toCents(outstanding) * bps(annualRate), 10_000n * 12n));
}

export interface Installment {
  installmentNo: number;
  dueOn: string;
  interest: string;
  principal: string;
  payment: string;
  outstandingAfter: string;
}

/**
 * What's left to pay: the schedule from the next installment, on what's
 * outstanding now. The last installment clears the balance exactly — the
 * tenure's last one takes up whatever the EMI's rounding to the paisa left.
 */
export function remainingSchedule(
  loan: { annualRate: string; emi: string; firstEmiOn: string; tenureMonths?: number },
  outstanding: string,
  nextInstallment: number,
): Installment[] {
  const out: Installment[] = [];
  let balance = toCents(outstanding);
  let n = nextInstallment;
  const payment = toCents(loan.emi);
  while (balance > 0n && out.length < 600) {
    const interest = toCents(monthlyInterest(fromCents(balance), loan.annualRate));
    let principal = payment - interest;
    if (principal <= 0n) break; // an EMI that doesn't cover interest never ends
    if (principal > balance || n >= (loan.tenureMonths ?? Infinity)) principal = balance;
    balance -= principal;
    out.push({
      installmentNo: n,
      dueOn: addMonths(firstOfMonth(loan.firstEmiOn), n - 1).slice(0, 8) + loan.firstEmiOn.slice(8, 10),
      interest: fromCents(interest),
      principal: fromCents(principal),
      payment: fromCents(interest + principal),
      outstandingAfter: fromCents(balance),
    });
    n += 1;
  }
  return out;
}

/** How a payment splits: this month's interest first, the rest off principal (never more than is owed). */
export function splitPayment(outstanding: string, annualRate: string, amount: string): { interest: string; principal: string; excess: string } {
  const interest = toCents(monthlyInterest(outstanding, annualRate));
  const paid = toCents(amount);
  const toInterest = paid < interest ? paid : interest;
  let principal = paid - toInterest;
  let excess = 0n;
  if (principal > toCents(outstanding)) {
    excess = principal - toCents(outstanding);
    principal = toCents(outstanding);
  }
  return { interest: fromCents(toInterest), principal: fromCents(principal), excess: fromCents(excess) };
}

// ---- Fuel ----

export interface Fill {
  filledOn: string;
  litres: string;
  amount: string;
  odometerKm: number | null;
}

/**
 * Distance from the odometer readings in the period, and fuel economy over
 * the fills after the first reading (the first fill's fuel was burnt
 * before it). Null when there aren't two readings to compare.
 */
export function fuelEconomy(fills: Fill[]): { km: number | null; kmPerLitre: string | null } {
  const read = fills.filter((f) => f.odometerKm !== null).sort((a, b) => a.odometerKm! - b.odometerKm!);
  if (read.length < 2) return { km: null, kmPerLitre: null };
  const km = read[read.length - 1].odometerKm! - read[0].odometerKm!;
  const litresMilli = read.slice(1).reduce((s, f) => {
    const [w, fr = ''] = f.litres.split('.');
    return s + BigInt(w) * 1000n + BigInt((fr + '000').slice(0, 3));
  }, 0n);
  if (km <= 0 || litresMilli === 0n) return { km: km > 0 ? km : null, kmPerLitre: null };
  const perLitreCenti = half(BigInt(km) * 100_000n, litresMilli); // km / litres, 2 dp
  return { km, kmPerLitre: `${perLitreCenti / 100n}.${(perLitreCenti % 100n).toString().padStart(2, '0')}` };
}
