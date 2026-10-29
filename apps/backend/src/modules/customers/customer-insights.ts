// How a customer pays, in two figures the owner reads at a glance (redesign
// Phase 5, "Customer Score" and the credit-risk flag). Plain arithmetic on
// what Finance already records, so the owner can check it by hand.

export interface PaymentBehaviour {
  /** Sale invoices paid in full. */
  settled: number;
  /** Of those, paid by their due date. */
  onTime: number;
  /** How many days the oldest unpaid invoice is past due; null when nothing is overdue. */
  oldestOverdueDays: number | null;
  creditHold: boolean;
}

/**
 * The customer score, 0–5 (one decimal): 5 × the share of invoices paid on
 * time, less a point for every 15 days (or part) the oldest unpaid invoice
 * is overdue (at most 4), and never above 1 while on credit hold. null for
 * a customer with no payment history yet.
 */
export function customerScore(b: PaymentBehaviour): number | null {
  if (b.settled === 0 && !b.oldestOverdueDays) return null;
  const base = b.settled > 0 ? (5 * b.onTime) / b.settled : 5;
  const penalty = b.oldestOverdueDays && b.oldestOverdueDays > 0 ? Math.min(4, Math.ceil(b.oldestOverdueDays / 15)) : 0;
  let score = Math.max(0, base - penalty);
  if (b.creditHold) score = Math.min(score, 1);
  return Math.round(score * 10) / 10;
}

/** Share of fully paid invoices paid by their due date, as a percentage; null with none paid. */
export function onTimePct(b: Pick<PaymentBehaviour, 'settled' | 'onTime'>): number | null {
  return b.settled > 0 ? Math.round((100 * b.onTime) / b.settled) : null;
}

/**
 * A customer to watch before giving more credit: on credit hold, an
 * invoice more than 30 days overdue, or 90% or more of the credit limit in
 * use (what they owe, less money held on account, plus confirmed orders
 * not yet delivered).
 */
export function isCreditRisk(input: {
  creditHold: boolean;
  oldestOverdueDays: number | null;
  creditLimit: number;
  outstanding: number;
  onAccount: number;
  openOrders: number;
}): boolean {
  if (input.creditHold) return true;
  if ((input.oldestOverdueDays ?? 0) > 30) return true;
  if (input.creditLimit <= 0) return false;
  const inUse = Math.max(0, input.outstanding - input.onAccount) + input.openOrders;
  return inUse >= 0.9 * input.creditLimit;
}
