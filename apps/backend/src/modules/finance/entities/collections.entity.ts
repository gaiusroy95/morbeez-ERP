export type CollectionsView = 'today' | 'pending' | 'all';

/**
 * A line on the owner's Collections list (redesign V1.1, screen 14): a
 * payment received from a customer, or — on Pending — a customer whose
 * money has fallen due and isn't in yet.
 */
export interface CollectionCard {
  kind: 'payment' | 'due';
  /** The payment's id, or the customer's for a due line. */
  id: string;
  customerId: string;
  customerName: string;
  place: string | null;
  /** What was collected, or what's due now. */
  amount: string;
  receivedAt: Date | null;
  method: string | null;
  /** The oldest unpaid due date, for a due line. */
  dueDate: string | null;
  overdueDays: number | null;
  /** paid: nothing left owing; partial: something still is; pending: due and not collected. */
  status: 'paid' | 'partial' | 'pending';
  /** What the customer owes now, after everything. */
  balance: string;
}

export interface CollectionsBoard {
  view: CollectionsView;
  counts: { today: number; pending: number; all: number };
  /** Collected today, and due now across every customer. */
  totals: { collectedToday: string; dueNow: string };
  items: CollectionCard[];
  total: number;
  page: number;
  pageSize: number;
}
