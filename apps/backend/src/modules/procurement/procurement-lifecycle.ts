import { compareMoney } from '../../common/money';

/**
 * A purchase from a farmer, in the Master Spec v3 §11 words:
 * DRAFT → CONFIRMED → ASSIGNED → PICKUP → PARTIALLY PICKED → PICKED UP → SETTLED
 * (or CANCELLED). Never stored: read from the order, its pickup's trip stop,
 * what was received, and whether the farmer has been paid — so it can't
 * disagree with them.
 */
export type ProcurementLifecycle = 'draft' | 'confirmed' | 'assigned' | 'pickup' | 'partially_picked' | 'picked_up' | 'settled' | 'cancelled';

export interface ProcurementLifecycleFacts {
  status: string;
  /** On a trip that isn't cancelled. */
  onTrip: boolean;
  /** The driver has reached the farm, and the stop isn't done yet. */
  arrived: boolean;
  /** The farm stop is done (or the pickup recorded without one). */
  pickedUp: boolean;
  /** Received and expected, in the products' own units, summed. */
  received: string;
  expected: string;
  /** What the farmer is still owed for this order; null while nothing has been accrued. */
  owed: string | null;
}

export function procurementLifecycleOf(f: ProcurementLifecycleFacts): ProcurementLifecycle {
  if (f.status === 'cancelled') return 'cancelled';
  if (f.status === 'placed') return 'draft';
  const received = Number(f.received) > 0;
  if (f.pickedUp || received) {
    if (f.owed !== null && compareMoney(f.owed, '0') <= 0) return 'settled';
    return Number(f.received) < Number(f.expected) ? 'partially_picked' : 'picked_up';
  }
  if (f.arrived) return 'pickup';
  if (f.onTrip) return 'assigned';
  return 'confirmed';
}
