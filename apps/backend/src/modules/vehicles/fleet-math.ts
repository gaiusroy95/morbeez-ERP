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
  /** Filled to the brim; a fill recorded without saying is taken as full. */
  fullTank?: boolean;
}

const litresMilliOf = (fills: Fill[]): bigint =>
  fills.reduce((s, f) => {
    const [w, fr = ''] = f.litres.split('.');
    return s + BigInt(w) * 1000n + BigInt((fr + '000').slice(0, 3));
  }, 0n);

/** km ÷ litres to 2 dp; null when either is nothing. */
function perLitre(km: number, litresMilli: bigint): string | null {
  if (km <= 0 || litresMilli === 0n) return null;
  const centi = half(BigInt(km) * 100_000n, litresMilli);
  return `${centi / 100n}.${(centi % 100n).toString().padStart(2, '0')}`;
}

/** The fills with an odometer reading, in the order the odometer read them. */
const readFills = <T extends Fill>(fills: T[]): T[] => fills.filter((f) => f.odometerKm !== null).sort((a, b) => a.odometerKm! - b.odometerKm!);

/**
 * Distance from the odometer readings in the period, and fuel economy from
 * full tank to full tank: the fuel put in after the first full tank, up to
 * and including the last, drove the km between them (a part fill in
 * between counts with them). With every fill full, that's every fill after
 * the first reading. Null when there aren't two readings (or two full
 * tanks) to compare.
 */
export function fuelEconomy(fills: Fill[]): { km: number | null; kmPerLitre: string | null } {
  const read = readFills(fills);
  if (read.length < 2) return { km: null, kmPerLitre: null };
  const km = read[read.length - 1].odometerKm! - read[0].odometerKm!;
  const fulls = read.map((f, i) => (f.fullTank === false ? -1 : i)).filter((i) => i >= 0);
  if (fulls.length < 2) return { km: km > 0 ? km : null, kmPerLitre: null };
  const first = fulls[0];
  const last = fulls[fulls.length - 1];
  const span = read[last].odometerKm! - read[first].odometerKm!;
  return { km: km > 0 ? km : null, kmPerLitre: perLitre(span, litresMilliOf(read.slice(first + 1, last + 1))) };
}

export interface FullTankMileage {
  /** The odometer at the full tank before the latest one, and at the latest. */
  fromKm: number;
  toKm: number;
  km: number;
  litres: string;
  kmPerLitre: string | null;
}

/**
 * The full tank before to the last full tank filled on [tripId] (the
 * mileage incentive, driver app D7): the km between them, and the litres and
 * cost of every fill after the first, up to and including it. Null when the
 * trip filled no full tank, or there's no full tank before it.
 */
export function tripMileageSegment(
  fills: (Fill & { tripId: string | null })[],
  tripId: string,
): { km: number; litres: string; cost: string } | null {
  const read = readFills(fills);
  const fulls = read.map((f, i) => (f.fullTank === false ? -1 : i)).filter((i) => i >= 0);
  const onTrip = fulls.filter((i) => read[i].tripId === tripId);
  if (onTrip.length === 0) return null;
  const to = onTrip[onTrip.length - 1];
  const from = fulls.filter((i) => i < to).pop();
  if (from === undefined) return null;
  const between = read.slice(from + 1, to + 1);
  const milli = litresMilliOf(between);
  const cents = between.reduce((s, f) => {
    const [w, fr = ''] = f.amount.split('.');
    return s + BigInt(w) * 100n + BigInt((fr + '00').slice(0, 2));
  }, 0n);
  return {
    km: read[to].odometerKm! - read[from].odometerKm!,
    litres: `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, '0')}`,
    cost: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`,
  };
}

/** The latest full tank to full tank (My Expenses' "Vehicle mileage"); null until there are two. */
export function lastFullTankMileage(fills: Fill[]): FullTankMileage | null {
  const read = readFills(fills);
  const fulls = read.map((f, i) => (f.fullTank === false ? -1 : i)).filter((i) => i >= 0);
  if (fulls.length < 2) return null;
  const from = fulls[fulls.length - 2];
  const to = fulls[fulls.length - 1];
  const km = read[to].odometerKm! - read[from].odometerKm!;
  const milli = litresMilliOf(read.slice(from + 1, to + 1));
  return {
    fromKm: read[from].odometerKm!,
    toKm: read[to].odometerKm!,
    km,
    litres: `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, '0')}`,
    kmPerLitre: perLitre(km, milli),
  };
}
