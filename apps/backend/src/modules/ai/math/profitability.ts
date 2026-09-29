// Customer profitability: what each customer contributed after the cost of
// the goods, the delivery runs that served them, the money tied up while
// they took time to pay, and the crates they lost. Money in paise.

import { fromCents, toCents } from '../../../common/money';

export interface CustomerFigures {
  customerId: string;
  invoices: number;
  revenue: string; // goods, before GST
  cogs: string;
  deliveryCost: string; // their share of the trips that served them
  financeChargeIncome: string;
  crateRecoveries: string;
  crateLossesAbsorbed: string;
  receivableRupeeDays: string; // Σ outstanding amount × days outstanding, in the period
  averageDaysToPay: number | null;
  paymentTermsDays: number;
}

export interface CustomerProfit extends CustomerFigures {
  grossMargin: string;
  grossMarginPct: number | null;
  creditCost: string;
  contribution: string;
  contributionPct: number | null;
  deliveryPct: number | null;
}

const pct = (part: bigint, whole: bigint) => (whole > 0n ? Math.round(Number((part * 10_000n) / whole)) / 100 : null);

/** Cost of carrying receivables: rupee-days × annual rate / 365. */
export function creditCost(rupeeDays: string, annualPct: string): string {
  const bpsRate = BigInt(Math.round(Number(annualPct) * 100));
  return fromCents((toCents(rupeeDays) * bpsRate + 1_825_000n) / 3_650_000n);
}

export function profit(f: CustomerFigures, costOfCapitalPct: string): CustomerProfit {
  const revenue = toCents(f.revenue);
  const gross = revenue - toCents(f.cogs);
  const credit = toCents(creditCost(f.receivableRupeeDays, costOfCapitalPct));
  const contribution = gross - toCents(f.deliveryCost) - credit - toCents(f.crateLossesAbsorbed) + toCents(f.financeChargeIncome) + toCents(f.crateRecoveries);
  return {
    ...f,
    grossMargin: fromCents(gross),
    grossMarginPct: pct(gross, revenue),
    creditCost: fromCents(credit),
    contribution: fromCents(contribution),
    contributionPct: pct(contribution, revenue),
    deliveryPct: pct(toCents(f.deliveryCost), revenue),
  };
}

export interface TermsAdvice {
  lever: 'payment_terms' | 'price' | 'order_size';
  why: string;
  proposal: { paymentTermsDays?: number; financeChargeRateMonthly?: string };
}

/**
 * What to change for a customer below the tenant's minimum contribution:
 * slow payers first (terms), then thin margins (price), then small drops
 * that cost more to deliver than they earn (order size). One lever — the
 * one with the most money behind it.
 */
export function adviseTerms(p: CustomerProfit): TermsAdvice | null {
  const slow = p.averageDaysToPay !== null && p.averageDaysToPay > p.paymentTermsDays + 7;
  const candidates: { value: bigint; advice: TermsAdvice }[] = [];
  if (slow) {
    candidates.push({
      value: toCents(p.creditCost),
      advice: {
        lever: 'payment_terms',
        why: `pays in ${p.averageDaysToPay} days on average against ${p.paymentTermsDays}-day terms`,
        proposal: { financeChargeRateMonthly: '1.50' },
      },
    });
  }
  if (p.grossMarginPct !== null && p.grossMarginPct < 10) {
    candidates.push({ value: toCents(p.revenue) / 10n, advice: { lever: 'price', why: `gross margin ${p.grossMarginPct}% on what they buy`, proposal: {} } });
  }
  if (p.deliveryPct !== null && p.deliveryPct > 8) {
    candidates.push({ value: toCents(p.deliveryCost), advice: { lever: 'order_size', why: `delivery takes ${p.deliveryPct}% of their revenue`, proposal: {} } });
  }
  candidates.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  return candidates[0]?.advice ?? null;
}
