// The incentive engine V1.18 (driver app V1, D7; client spec §24–§25; the
// client's answer 7: each incentive is an owner-set percentage of its base).
// Worked out by the backend from the trip's data — never entered by the
// driver. Pure: the facts come in, each incentive's base, percentage, amount
// and why go out; unit-tested with exact figures (trip-incentives.spec.ts).
//
// The bases, as the client confirmed them (2 Nov 2026) — each one's eligibility
// conditions the owner's to change (IncentiveConditions):
//   collection   — what was collected on the trip, every method
//   backhaul     — backhaul rent received
//   mileage      — the fuel saved against the owner's km/l target, at what it
//                  cost, from the full tank before to the full tank on this trip
//   crates       — crates brought back from customers, at replacement cost
//   quality      — the goods delivered, when no delivery was short
//   new_customer — the first delivery to a customer never delivered before
//   performance  — the goods delivered, when every stop was done
//   night_duty   — the day's fixed pay, when the trip was on the road at night
//   data_quality — the day's fixed pay, when the trip's records are complete
//   completion   — the day's fixed pay, when the owner closed it as a pass

import { compareMoney, fromCents, percentOfMoney, toCents } from '../../common/money';

export const INCENTIVE_KINDS = [
  'collection',
  'backhaul',
  'mileage',
  'crates',
  'quality',
  'new_customer',
  'performance',
  'night_duty',
  'data_quality',
  'completion',
] as const;
export type IncentiveKind = (typeof INCENTIVE_KINDS)[number];

export const INCENTIVE_LABEL: Record<IncentiveKind, string> = {
  collection: 'Collection incentive',
  backhaul: 'Backhaul incentive',
  mileage: 'Mileage incentive',
  crates: 'Crate incentive',
  quality: 'Quality incentive',
  new_customer: 'New customer incentive',
  performance: 'Performance incentive',
  night_duty: 'Night duty',
  data_quality: 'Data quality',
  completion: 'Trip completion',
};

/** What each one is a percentage of — shown beside the owner's setting. */
export const INCENTIVE_BASE: Record<IncentiveKind, string> = {
  collection: 'of what the driver collected on the trip',
  backhaul: 'of the backhaul rent received',
  mileage: 'of the fuel saved against the km/l target, at its cost',
  crates: 'of the crates brought back from customers, at replacement cost',
  quality: 'of the goods delivered, when no delivery was short',
  new_customer: "of a new customer's first delivery",
  performance: 'of the goods delivered, when every stop was done',
  night_duty: "of the day's fixed pay, when on the road at night",
  data_quality: "of the day's fixed pay, when the trip's records are complete",
  completion: "of the day's fixed pay, when the trip closes as a pass",
};

/** What the owner's form starts from — a suggestion; nothing is paid until the owner saves. */
export const SUGGESTED_PERCENT: Record<IncentiveKind, string> = {
  collection: '0.200',
  backhaul: '10.000',
  mileage: '50.000',
  crates: '1.000',
  quality: '0.100',
  new_customer: '2.000',
  performance: '0.200',
  night_duty: '25.000',
  data_quality: '10.000',
  completion: '20.000',
};

export interface IncentiveRuleSetting {
  kind: IncentiveKind;
  enabled: boolean;
  percent: string;
}

/**
 * When an incentive is earned — the owner's to change (the client: "modify
 * eligibility conditions"); each starts as the proposal above.
 */
export interface IncentiveConditions {
  /** Collection: at least this much collected on the trip. */
  minCollected: string;
  /** Crates: at least this many brought back. */
  minCrates: number;
  /** Quality: deliveries that may be short and still earn it. */
  qualityShortAllowed: number;
  /** Performance: stops that may be left undone and still earn it. */
  performanceSkipsAllowed: number;
  /** Data quality: what must be recorded. */
  dataQualityNeeds: { km: boolean; deliveryPhotos: boolean; bills: boolean };
  /** Trip completion: also when the owner closes it as an approved exception. */
  completionOnException: boolean;
}

export const DEFAULT_CONDITIONS: IncentiveConditions = {
  minCollected: '0.00',
  minCrates: 1,
  qualityShortAllowed: 0,
  performanceSkipsAllowed: 0,
  dataQualityNeeds: { km: true, deliveryPhotos: true, bills: true },
  completionOnException: false,
};

/** The owner's saved conditions over the defaults: anything missing or malformed is the default. */
export function conditionsOf(saved: unknown): IncentiveConditions {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const count = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d);
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const needs = (s.dataQualityNeeds && typeof s.dataQualityNeeds === 'object' ? s.dataQualityNeeds : {}) as Record<string, unknown>;
  return {
    minCollected: typeof s.minCollected === 'string' && /^\d+(\.\d{1,2})?$/.test(s.minCollected) ? s.minCollected : DEFAULT_CONDITIONS.minCollected,
    minCrates: Math.max(1, count(s.minCrates, DEFAULT_CONDITIONS.minCrates)),
    qualityShortAllowed: count(s.qualityShortAllowed, DEFAULT_CONDITIONS.qualityShortAllowed),
    performanceSkipsAllowed: count(s.performanceSkipsAllowed, DEFAULT_CONDITIONS.performanceSkipsAllowed),
    dataQualityNeeds: {
      km: flag(needs.km, true),
      deliveryPhotos: flag(needs.deliveryPhotos, true),
      bills: flag(needs.bills, true),
    },
    completionOnException: flag(s.completionOnException, DEFAULT_CONDITIONS.completionOnException),
  };
}

export interface IncentiveRules {
  rules: IncentiveRuleSetting[];
  targetKmPerLitre: string | null;
  /** 'HH:MM': on the road at or after [nightFrom], or before [nightUntil], is night duty. */
  nightFrom: string;
  nightUntil: string;
  /** When each is earned; the defaults when not given. */
  conditions?: IncentiveConditions;
}

/** A full tank to the full tank on this trip: what the vehicle ran on it. */
export interface MileageSegment {
  km: number;
  litres: string;
  cost: string;
}

/** What the trip did, as the backend read it. */
export interface TripFacts {
  /** pass | approved_exception once the owner closed it; null for an estimate before. */
  outcome: 'pass' | 'approved_exception' | null;
  /** The driver's fixed pay for the day; null when their pay isn't by the day (or not set). */
  dayPay: string | null;
  collected: string;
  backhaulReceived: string;
  deliveredValue: string;
  deliveries: number;
  shortDeliveries: number;
  stops: number;
  skippedStops: number;
  cratesBack: number;
  cratesValue: string;
  newCustomers: number;
  newCustomerValue: string;
  /** Local 'HH:MM' when the trip set off and was back; [overnight] when it ended on a later day. */
  startedAt: string | null;
  endedAt: string | null;
  overnight: boolean;
  hasOpeningKm: boolean;
  hasClosingKm: boolean;
  deliveriesWithoutPhoto: number;
  expensesWithoutBill: number;
  mileage: MileageSegment | null;
}

export interface IncentiveLine {
  kind: IncentiveKind;
  base: string;
  percent: string;
  amount: string;
  detail: string;
}

const ZERO = '0.00';
const rupees = (v: string) => `₹${v}`;
const positive = (v: string) => compareMoney(v, ZERO) > 0;

/** Litres ("65.400") and money ("6049.50") to thousandths / paise. */
const milli = (v: string) => {
  const [w, f = ''] = v.split('.');
  return BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3));
};

/**
 * The fuel saved against the target, at what the fuel cost: (km ÷ target −
 * litres) × cost per litre, when positive. Null without a target or a segment.
 */
export function fuelSaved(segment: MileageSegment | null, target: string | null): { litres: string; value: string } | null {
  if (!segment || !target || segment.km <= 0) return null;
  const used = milli(segment.litres);
  const targetMilli = milli(target);
  if (used <= 0n || targetMilli <= 0n) return null;
  const expected = (BigInt(segment.km) * 1_000_000n + targetMilli / 2n) / targetMilli; // litres, thousandths
  const saved = expected - used;
  if (saved <= 0n) return { litres: '0.000', value: ZERO };
  const value = (saved * toCents(segment.cost) * 2n + used) / (2n * used); // saved × cost ÷ used, paise
  return { litres: `${saved / 1000n}.${(saved % 1000n).toString().padStart(3, '0')}`, value: fromCents(value) };
}

/** On the road at night: set off before [until], or back at or after [from], or back on a later day. */
export function wasNight(f: Pick<TripFacts, 'startedAt' | 'endedAt' | 'overnight'>, from: string, until: string): boolean {
  if (f.overnight) return true;
  if (f.startedAt && f.startedAt < until) return true;
  return !!f.endedAt && f.endedAt >= from;
}

/** The base of each incentive, and why it is what it is (or nothing). */
function baseOf(kind: IncentiveKind, f: TripFacts, r: IncentiveRules): { base: string; detail: string } {
  const c = r.conditions ?? DEFAULT_CONDITIONS;
  const dayPay = (when: boolean, yes: string, no: string) =>
    f.dayPay === null ? { base: ZERO, detail: 'No fixed daily pay to work it out from' } : when ? { base: f.dayPay, detail: yes } : { base: ZERO, detail: no };
  switch (kind) {
    case 'collection':
      if (!positive(f.collected)) return { base: ZERO, detail: 'Nothing collected' };
      return compareMoney(f.collected, c.minCollected) >= 0
        ? { base: f.collected, detail: `${rupees(f.collected)} collected` }
        : { base: ZERO, detail: `${rupees(f.collected)} collected — less than ${rupees(c.minCollected)}` };
    case 'backhaul':
      return positive(f.backhaulReceived) ? { base: f.backhaulReceived, detail: `${rupees(f.backhaulReceived)} backhaul rent received` } : { base: ZERO, detail: 'No backhaul paid' };
    case 'mileage': {
      if (!r.targetKmPerLitre) return { base: ZERO, detail: 'No km/l target set' };
      if (!f.mileage) return { base: ZERO, detail: 'No full tank on this trip — mileage is judged at the next one' };
      const saved = fuelSaved(f.mileage, r.targetKmPerLitre)!;
      const run = `${f.mileage.km} km on ${f.mileage.litres} L against ${r.targetKmPerLitre} km/l`;
      return positive(saved.value) ? { base: saved.value, detail: `${run}: ${saved.litres} L saved, ${rupees(saved.value)}` } : { base: ZERO, detail: `${run}: no fuel saved` };
    }
    case 'crates':
      if (f.cratesBack === 0) return { base: ZERO, detail: 'No crates brought back' };
      return f.cratesBack >= c.minCrates
        ? { base: f.cratesValue, detail: `${f.cratesBack} crate(s) brought back, worth ${rupees(f.cratesValue)}` }
        : { base: ZERO, detail: `${f.cratesBack} crate(s) brought back — fewer than ${c.minCrates}` };
    case 'quality':
      if (f.deliveries === 0) return { base: ZERO, detail: 'No deliveries' };
      return f.shortDeliveries <= c.qualityShortAllowed
        ? { base: f.deliveredValue, detail: f.shortDeliveries === 0 ? `${rupees(f.deliveredValue)} delivered, none short` : `${rupees(f.deliveredValue)} delivered, ${f.shortDeliveries} short (${c.qualityShortAllowed} allowed)` }
        : { base: ZERO, detail: `${f.shortDeliveries} delivery(ies) short` };
    case 'new_customer':
      return f.newCustomers > 0
        ? { base: f.newCustomerValue, detail: `${f.newCustomers} new customer(s), first delivery ${rupees(f.newCustomerValue)}` }
        : { base: ZERO, detail: 'No new customer' };
    case 'performance':
      if (f.stops === 0) return { base: ZERO, detail: 'No stops' };
      return f.skippedStops <= c.performanceSkipsAllowed
        ? { base: f.deliveredValue, detail: f.skippedStops === 0 ? `Every stop done, ${rupees(f.deliveredValue)} delivered` : `${f.skippedStops} stop(s) not done (${c.performanceSkipsAllowed} allowed), ${rupees(f.deliveredValue)} delivered` }
        : { base: ZERO, detail: `${f.skippedStops} stop(s) not done` };
    case 'night_duty':
      return dayPay(wasNight(f, r.nightFrom, r.nightUntil), `On the road at night (${f.startedAt ?? '—'} to ${f.endedAt ?? '—'})`, 'No night duty');
    case 'data_quality': {
      const needs = c.dataQualityNeeds;
      const gaps = [
        needs.km && (!f.hasOpeningKm || !f.hasClosingKm) ? 'KM not recorded' : null,
        needs.deliveryPhotos && f.deliveriesWithoutPhoto > 0 ? `${f.deliveriesWithoutPhoto} delivery(ies) without a photo` : null,
        needs.bills && f.expensesWithoutBill > 0 ? `${f.expensesWithoutBill} expense(s) without a bill` : null,
      ].filter((g): g is string => g !== null);
      const asked = [needs.km ? 'KM' : null, needs.deliveryPhotos ? 'delivery photos' : null, needs.bills ? 'bills' : null].filter(Boolean).join(', ');
      return dayPay(gaps.length === 0, asked ? `${asked} all recorded` : 'Nothing required', gaps.join('; '));
    }
    case 'completion':
      return f.outcome === null
        ? dayPay(true, 'If the owner closes the trip as a pass', '')
        : dayPay(f.outcome === 'pass' || c.completionOnException, f.outcome === 'pass' ? 'Closed as a pass' : 'Closed with an approved exception', 'Closed with an exception');
  }
}

/**
 * The trip's incentives under the owner's rules: one line for each one the
 * owner has switched on (an amount of nothing says why), in the rules' order.
 */
export function incentivesOf(facts: TripFacts, rules: IncentiveRules): IncentiveLine[] {
  const out: IncentiveLine[] = [];
  for (const kind of INCENTIVE_KINDS) {
    const rule = rules.rules.find((x) => x.kind === kind);
    if (!rule?.enabled) continue;
    const { base, detail } = baseOf(kind, facts, rules);
    out.push({ kind, base, percent: rule.percent, amount: percentOfMoney(base, rule.percent), detail });
  }
  return out;
}

/** The driver's fixed pay for a day, from the pay rate in force: daily as it is, monthly over the month's days, hourly for an 8-hour day. */
export function dayPayOf(rate: { payBasis: 'monthly' | 'daily' | 'hourly' | 'piece'; rate: string } | null, date: string): string | null {
  if (!rate) return null;
  switch (rate.payBasis) {
    case 'daily':
      return fromCents(toCents(rate.rate));
    case 'hourly':
      return fromCents(toCents(rate.rate) * 8n);
    case 'monthly': {
      const [y, m] = date.split('-').map(Number);
      const days = BigInt(new Date(Date.UTC(y, m, 0)).getUTCDate());
      return fromCents((toCents(rate.rate) * 2n + days) / (2n * days));
    }
    default:
      return null;
  }
}
