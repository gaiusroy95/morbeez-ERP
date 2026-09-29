// A worker's pay for a period, computed from what they did (assignments),
// what they're paid (effective-dated pay rates), incentive rules, the
// minimum wage for their state and skill, and advances to recover. Pure:
// no database, no clock — every rule here is unit-tested with exact
// figures. All money is integer paise; quantities integer thousandths.

import { fromCents, multiplyToMoney, toCents } from '../../common/money';
import {
  IncentiveRule,
  MinimumWageRate,
  PayRate,
  SettlementLine,
  SkillCategory,
} from './entities/payroll.entity';

export interface WorkDay {
  // Completed and absent assignments in the period; planned and cancelled
  // ones earn nothing and are left out by the caller.
  date: string;
  status: 'completed' | 'absent';
  kind: string;
  hours: string | null;
  units: string | null;
}

export interface EarningsInput {
  periodStart: string;
  periodEnd: string;
  roleType: string;
  skillCategory: SkillCategory;
  stateCode: string | null; // work state, else the tenant default
  joinedOn: string | null;
  leftOn: string | null;
  rates: PayRate[];
  work: WorkDay[];
  incentiveRules: IncentiveRule[];
  minimumWages: MinimumWageRate[]; // any state/category; filtered here
  minWagePolicy: 'top_up' | 'warn';
  adjustments: { description: string; amount: string }[];
  advances: { id: string; paidOn: string; outstanding: string }[]; // oldest first
  maxAdvanceRecovery: string | null; // null = recover as much as the net allows
}

export interface EarningsResult {
  lines: SettlementLine[];
  daysWorked: number;
  gross: string;
  deductions: string;
  net: string;
  warnings: string[];
}

const STANDARD_DAY_HOURS_CENTI = 800n; // an 8-hour day, in hundredths of an hour

// ---- Dates (YYYY-MM-DD strings, calendar arithmetic in UTC) ----

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function daysInMonth(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const inForce = (r: { effectiveFrom: string; effectiveTo: string | null }, d: string) =>
  r.effectiveFrom <= d && (r.effectiveTo === null || r.effectiveTo >= d);

/** The rule in force on a date; the latest start wins if two overlap. */
export function inForceOn<T extends { effectiveFrom: string; effectiveTo: string | null }>(rules: T[], d: string): T | null {
  return rules.filter((r) => inForce(r, d)).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
}

// ---- Exact quantities ----

/** "7.5" → 750 (hundredths). */
function centi(value: string): bigint {
  const [w, f = ''] = value.split('.');
  return BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
}

/** "12.25" → 12250 (thousandths). */
function milli(value: string): bigint {
  const [w, f = ''] = value.split('.');
  return BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3));
}

const fromMilli = (m: bigint) => `${m / 1000n}.${(m % 1000n).toString().padStart(3, '0')}`;
const fromCenti = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;

/** a × num / den, half-up, all non-negative integers. */
const scale = (a: bigint, num: bigint, den: bigint) => (a * num * 2n + den) / (den * 2n);

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (d: string) => `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export function computeEarnings(input: EarningsInput): EarningsResult {
  const warnings: string[] = [];
  const lines: SettlementLine[] = [];
  const line = (l: Partial<SettlementLine> & Pick<SettlementLine, 'kind' | 'description' | 'amount'>): SettlementLine => ({
    quantity: null,
    rate: null,
    incentiveRuleId: null,
    advanceId: null,
    ...l,
  });

  const byDate = new Map<string, WorkDay[]>();
  for (const w of input.work) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const completedOn = (d: string) => (byDate.get(d) ?? []).filter((w) => w.status === 'completed');
  const employed = (d: string) => (!input.joinedOn || d >= input.joinedOn) && (!input.leftOn || d <= input.leftOn);

  // ---- Basic pay, day by day, at the rate in force that day ----
  type Bucket = { basis: PayRate['payBasis']; rate: string; unit: string | null; qty: bigint; month?: string; dim?: number };
  const buckets = new Map<string, Bucket>();
  const add = (key: string, b: Omit<Bucket, 'qty'>, qty: bigint) => {
    const cur = buckets.get(key) ?? { ...b, qty: 0n };
    cur.qty += qty;
    buckets.set(key, cur);
  };
  const countedDays: { date: string; fraction: { num: bigint; den: bigint } }[] = [];
  const missingRate = new Set<string>();
  const missingHours = new Set<string>();

  for (const d of eachDate(input.periodStart, input.periodEnd)) {
    const rate = inForceOn(input.rates, d);
    const done = completedOn(d);
    if (!rate) {
      if (done.length) missingRate.add(d);
      continue;
    }
    switch (rate.payBasis) {
      case 'monthly': {
        const absentOnly = (byDate.get(d) ?? []).length > 0 && done.length === 0;
        if (!employed(d) || absentOnly) break;
        add(`m:${rate.rate}:${d.slice(0, 7)}`, { basis: 'monthly', rate: rate.rate, unit: null, month: d.slice(0, 7), dim: daysInMonth(d) }, 1n);
        countedDays.push({ date: d, fraction: { num: 1n, den: 1n } });
        break;
      }
      case 'daily':
        if (done.length === 0) break;
        add(`d:${rate.rate}`, { basis: 'daily', rate: rate.rate, unit: null }, 1n);
        countedDays.push({ date: d, fraction: { num: 1n, den: 1n } });
        break;
      case 'hourly': {
        if (done.length === 0) break;
        let hours = 0n;
        for (const w of done) {
          if (w.hours === null) missingHours.add(d);
          else hours += centi(w.hours);
        }
        if (hours === 0n) break;
        add(`h:${rate.rate}`, { basis: 'hourly', rate: rate.rate, unit: null }, hours);
        // A short day counts as that share of a day for the minimum wage.
        countedDays.push({ date: d, fraction: { num: hours < STANDARD_DAY_HOURS_CENTI ? hours : STANDARD_DAY_HOURS_CENTI, den: STANDARD_DAY_HOURS_CENTI } });
        break;
      }
      case 'piece': {
        if (done.length === 0) break;
        const units = done.reduce((s, w) => s + (w.units === null ? 0n : milli(w.units)), 0n);
        if (units > 0n) add(`p:${rate.rate}:${rate.unitLabel}`, { basis: 'piece', rate: rate.rate, unit: rate.unitLabel }, units);
        countedDays.push({ date: d, fraction: { num: 1n, den: 1n } });
        break;
      }
    }
  }
  if (missingRate.size) warnings.push(`No pay rate in force on ${[...missingRate].sort().join(', ')} — that work isn't paid.`);
  if (missingHours.size) warnings.push(`Work on ${[...missingHours].sort().join(', ')} has no hours recorded — not paid by the hour.`);

  for (const b of buckets.values()) {
    switch (b.basis) {
      case 'monthly': {
        const amount = scale(toCents(b.rate), b.qty, BigInt(b.dim!));
        lines.push(
          line({
            kind: 'basic',
            description: `Salary, ${monthLabel(`${b.month}-01`)} — ${b.qty} of ${b.dim} days`,
            quantity: fromMilli(b.qty * 1000n),
            rate: b.rate,
            amount: fromCents(amount),
          }),
        );
        break;
      }
      case 'daily':
        lines.push(
          line({ kind: 'basic', description: `Daily wage — ${b.qty} day(s)`, quantity: fromMilli(b.qty * 1000n), rate: b.rate, amount: fromCents(toCents(b.rate) * b.qty) }),
        );
        break;
      case 'hourly':
        lines.push(
          line({ kind: 'basic', description: `Hourly wage — ${fromCenti(b.qty)} h`, quantity: fromMilli(b.qty * 10n), rate: b.rate, amount: multiplyToMoney(fromMilli(b.qty * 10n), b.rate) }),
        );
        break;
      case 'piece':
        lines.push(
          line({ kind: 'basic', description: `Piece rate — ${fromMilli(b.qty)} ${b.unit}`, quantity: fromMilli(b.qty), rate: b.rate, amount: multiplyToMoney(fromMilli(b.qty), b.rate) }),
        );
        break;
    }
  }
  const basic = lines.reduce((s, l) => s + toCents(l.amount), 0n);
  const daysWorked = new Set(countedDays.map((c) => c.date)).size;

  // ---- Incentives: rules in force on the last day of the period ----
  const completedAll = input.work.filter((w) => w.status === 'completed');
  const trips = BigInt(completedAll.filter((w) => w.kind === 'trip').length) * 1000n;
  const units = completedAll.reduce((s, w) => s + (w.units === null ? 0n : milli(w.units)), 0n);
  for (const rule of input.incentiveRules) {
    if (!inForce(rule, input.periodEnd)) continue;
    if (rule.roleType && rule.roleType !== input.roleType) continue;
    const threshold = milli(rule.threshold);
    if (rule.basis === 'attendance') {
      if (BigInt(daysWorked) * 1000n >= threshold && daysWorked > 0) {
        lines.push(line({ kind: 'incentive', description: `${rule.name} — ${daysWorked} days worked`, amount: rule.amount, incentiveRuleId: rule.id }));
      }
      continue;
    }
    const measured = rule.basis === 'per_trip' ? trips : units;
    const excess = measured - threshold;
    if (excess <= 0n) continue;
    const what = rule.basis === 'per_trip' ? `${excess / 1000n} trip(s)` : `${fromMilli(excess)} units`;
    lines.push(
      line({
        kind: 'incentive',
        description: `${rule.name} — ${what} above ${fromMilli(threshold).replace(/\.?0+$/, '')}`,
        quantity: fromMilli(excess),
        rate: rule.amount,
        amount: multiplyToMoney(fromMilli(excess), rule.amount),
        incentiveRuleId: rule.id,
      }),
    );
  }

  // ---- Minimum wage: basic pay never below the notified daily rate ----
  if (countedDays.length) {
    if (!input.stateCode) {
      warnings.push('No work state for this worker (or default state) — minimum wage not checked.');
    } else {
      const rates = input.minimumWages.filter((r) => r.stateCode === input.stateCode && r.skillCategory === input.skillCategory);
      let floor = 0n;
      const uncovered: string[] = [];
      for (const c of countedDays) {
        const r = inForceOn(rates, c.date);
        if (!r) uncovered.push(c.date);
        else floor += scale(toCents(r.dailyRate), c.fraction.num, c.fraction.den);
      }
      if (uncovered.length) {
        warnings.push(
          `No minimum wage entered for state ${input.stateCode}, ${input.skillCategory.replace('_', '-')} on ${uncovered.length} day(s) — not checked for those days.`,
        );
      }
      if (floor > basic) {
        const shortfall = floor - basic;
        if (input.minWagePolicy === 'top_up') {
          lines.push(
            line({
              kind: 'minimum_wage_topup',
              description: `Minimum wage top-up — basic ${fromCents(basic)} below the ${fromCents(floor)} minimum for the days worked`,
              amount: fromCents(shortfall),
            }),
          );
        } else {
          warnings.push(`Basic pay ${fromCents(basic)} is ${fromCents(shortfall)} below the minimum wage of ${fromCents(floor)} for the days worked.`);
        }
      }
    }
  }

  // ---- Adjustments ----
  for (const a of input.adjustments) {
    if (toCents(a.amount) === 0n) continue;
    lines.push(line({ kind: 'adjustment', description: a.description, amount: fromCents(toCents(a.amount)) }));
  }

  // ---- Advance recovery, oldest first, never below zero net ----
  const netBefore = lines.reduce((s, l) => s + toCents(l.amount), 0n);
  if (netBefore < 0n) warnings.push('Deductions exceed earnings — reduce the adjustments.');
  let room = netBefore > 0n ? netBefore : 0n;
  if (input.maxAdvanceRecovery !== null) {
    const cap = toCents(input.maxAdvanceRecovery);
    if (cap < room) room = cap;
  }
  for (const adv of input.advances) {
    if (room <= 0n) break;
    const take = toCents(adv.outstanding) < room ? toCents(adv.outstanding) : room;
    if (take <= 0n) continue;
    lines.push(line({ kind: 'advance_recovery', description: `Advance of ${adv.paidOn} recovered`, amount: fromCents(-take), advanceId: adv.id }));
    room -= take;
  }

  const gross = lines.filter((l) => toCents(l.amount) > 0n).reduce((s, l) => s + toCents(l.amount), 0n);
  const deductions = lines.filter((l) => toCents(l.amount) < 0n).reduce((s, l) => s - toCents(l.amount), 0n);
  return {
    lines,
    daysWorked,
    gross: fromCents(gross),
    deductions: fromCents(deductions),
    net: fromCents(gross - deductions),
    warnings,
  };
}
