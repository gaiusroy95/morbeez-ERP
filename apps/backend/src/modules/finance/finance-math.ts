import { fromCents, toCents } from '../../common/money';
import { fromMilli, toMilli } from '../../common/quantity';

// The finance engine's arithmetic, kept pure so every rounding decision is
// unit-tested rather than buried in a service. All money in and out is a
// 2-dp decimal string (Constitution III.2).

export interface OpenItem {
  id: string;
  outstanding: string;
}

export interface Allocation {
  id: string;
  amount: string;
}

/**
 * Applies `amount` to `items` in the order given (callers pass them oldest
 * due first), each up to its outstanding balance. Returns the allocations
 * made and whatever couldn't be applied.
 */
export function allocateInOrder(amount: string, items: OpenItem[]): { allocations: Allocation[]; remainder: string } {
  let left = toCents(amount);
  const allocations: Allocation[] = [];
  for (const item of items) {
    if (left <= 0n) break;
    const open = toCents(item.outstanding);
    if (open <= 0n) continue;
    const take = open < left ? open : left;
    allocations.push({ id: item.id, amount: fromCents(take) });
    left -= take;
  }
  return { allocations, remainder: fromCents(left) };
}

/**
 * The pilot formula (client Q&A, finance): outstanding principal × annual
 * rate × overdue days ÷ 365, rounded half-up to the paisa — in integer paise
 * × basis points, so no step goes through a float. Partial payments lower
 * the principal at once (the caller passes what's outstanding now).
 */
export function financeChargeAnnual(principal: string, ratePercentAnnual: string, days: number): string {
  if (!Number.isInteger(days) || days <= 0) return '0.00';
  const principalCents = toCents(principal);
  const rateBasisPoints = toCents(ratePercentAnnual); // "18.00" % → 1800 basis points
  if (principalCents <= 0n || rateBasisPoints <= 0n) return '0.00';
  const numerator = principalCents * rateBasisPoints * BigInt(days);
  const denominator = 10_000n * 365n;
  return fromCents((numerator * 2n + denominator) / (denominator * 2n));
}

/** Whole calendar days from `from` to `to` (YYYY-MM-DD), negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** YYYY-MM-DD plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The later of two YYYY-MM-DD dates. */
export function laterDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** An invoice line as it was taxed: its value and the GST on it. */
export interface TaxedLine {
  invoiceLineId: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
}

export interface CreditNoteSplit {
  lines: TaxedLine[];
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  amount: string;
}

const TAXES = ['cgst', 'sgst', 'igst', 'cess'] as const;
const lineTotal = (l: TaxedLine) => toCents(l.taxableValue) + TAXES.reduce((s, k) => s + toCents(l[k]), 0n);
const halfUp = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (denominator * 2n);

/**
 * A credit note of `amount` (what the customer owes less, GST included) spread
 * over the invoice's lines in proportion to each line's total, and within a
 * line between its value and its taxes in the proportions it was taxed at
 * (CN.1; GST Act s.34 — the note reduces the tax charged on the supply).
 * Integer paise throughout: the shares add up to `amount` exactly, the
 * largest remainders taking the odd paisa. Throws if `amount` is more than
 * the lines carry.
 */
export function splitCreditNote(amount: string, invoiceLines: TaxedLine[]): CreditNoteSplit {
  const credit = toCents(amount);
  const totals = invoiceLines.map(lineTotal);
  const invoiceTotal = totals.reduce((s, t) => s + t, 0n);
  if (credit <= 0n) throw new Error('A credit note must be for more than nothing');
  if (credit > invoiceTotal) throw new Error(`A credit note of ${amount} is more than the invoice's ${fromCents(invoiceTotal)}`);

  // Largest-remainder shares of the credit, one per line.
  const raw = totals.map((t) => credit * t);
  const shares = raw.map((r) => r / invoiceTotal);
  let left = credit - shares.reduce((s, x) => s + x, 0n);
  const byRemainder = raw.map((r, i) => ({ i, rem: r % invoiceTotal })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of byRemainder) {
    if (left <= 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }

  const lines: TaxedLine[] = [];
  const sums = { taxableValue: 0n, cgst: 0n, sgst: 0n, igst: 0n, cess: 0n };
  invoiceLines.forEach((line, i) => {
    const share = shares[i];
    if (share <= 0n) return;
    const taxes = TAXES.map((k) => halfUp(share * toCents(line[k]), totals[i]));
    // Rounding each tax up can't leave the value below nothing: trim the largest tax if it would.
    let taxable = share - taxes.reduce((s, x) => s + x, 0n);
    while (taxable < 0n) {
      const k = taxes.indexOf(taxes.reduce((m, x) => (x > m ? x : m), 0n));
      taxes[k] -= 1n;
      taxable += 1n;
    }
    lines.push({
      invoiceLineId: line.invoiceLineId,
      taxableValue: fromCents(taxable),
      cgst: fromCents(taxes[0]),
      sgst: fromCents(taxes[1]),
      igst: fromCents(taxes[2]),
      cess: fromCents(taxes[3]),
    });
    sums.taxableValue += taxable;
    sums.cgst += taxes[0];
    sums.sgst += taxes[1];
    sums.igst += taxes[2];
    sums.cess += taxes[3];
  });
  return {
    lines,
    taxableValue: fromCents(sums.taxableValue),
    cgst: fromCents(sums.cgst),
    sgst: fromCents(sums.sgst),
    igst: fromCents(sums.igst),
    cess: fromCents(sums.cess),
    amount: fromCents(credit),
  };
}

/**
 * An agent's commission on a graded lot (Master Spec §11; AGT.1, AGT.3):
 * accepted kg × the purchase's commission per kg, half-up to the paisa. A
 * lot weighed in grams is converted (to the gram); a lot counted in any
 * other unit (pieces, crates, trays) has no kg to pay on — null.
 */
export function agentCommission(acceptedQuantity: string, uom: string, ratePerKg: string): { kg: string; amount: string } | null {
  const quantity = toMilli(acceptedQuantity);
  const rate = toCents(ratePerKg);
  if (quantity <= 0n || rate <= 0n) return null;
  let kgMilli: bigint;
  if (uom === 'kg') kgMilli = quantity;
  else if (uom === 'g') kgMilli = halfUp(quantity, 1000n);
  else return null;
  if (kgMilli <= 0n) return null;
  const amount = halfUp(kgMilli * rate, 1000n);
  if (amount <= 0n) return null;
  return { kg: fromMilli(kgMilli), amount: fromCents(amount) };
}

/** A finance-charge period that left a disputed amount out. */
export interface PausedPeriod {
  periodStart: string;
  periodEnd: string;
  days: number;
}

/**
 * What a dispute's paused finance charge comes to once the pause ends (MS
 * §32): the principal no longer protected — the rejected part of a closed
 * dispute, or all of one left 30 days without action — for every day it was
 * left out, at the customer's rate, in one charge. The periods charged while
 * it paused follow one another, but a pause can stop and start, so the days
 * are their sum, not the span.
 */
export function disputeCatchUp(
  principal: string,
  ratePercentAnnual: string,
  periods: PausedPeriod[],
): { amount: string; days: number; periodStart: string; periodEnd: string } | null {
  if (periods.length === 0 || toCents(principal) <= 0n) return null;
  const days = periods.reduce((s, p) => s + p.days, 0);
  const periodStart = periods.reduce((m, p) => (p.periodStart < m ? p.periodStart : m), periods[0].periodStart);
  const periodEnd = periods.reduce((m, p) => (p.periodEnd > m ? p.periodEnd : m), periods[0].periodEnd);
  return { amount: financeChargeAnnual(principal, ratePercentAnnual, days), days, periodStart, periodEnd };
}
