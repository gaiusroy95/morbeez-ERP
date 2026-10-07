import { compareMoney, normalizeMoney, subtractMoney, sumMoney } from '../../common/money';
import { ChecklistItem } from './entities/trip-reconciliation.entity';
import { TripReviewFacts } from './repositories/trip-reconciliations.repository';

/**
 * What the driver should hand over (pilot baseline, money handover):
 *
 *   expected = opening cash (the advance) + cash collected at deliveries
 *              + other cash receipts (spot sales) − cash expenses
 *              − cash deposited in the bank on the road
 *
 * UPI/bank/cheque payments went straight to the business: they're shown,
 * never handed over.
 */
export interface HandoverSummary {
  openingCash: string;
  cashCollections: string;
  spotCash: string;
  expenses: string;
  deposited: string;
  expected: string;
  declared: string | null;
  directPayments: string;
}

export function handoverOf(input: {
  advance: string;
  cashCollections: string;
  spotCash: string;
  expenses: string;
  deposited: string;
  declared: string | null;
  directPayments: string;
}): HandoverSummary {
  const expected = subtractMoney(
    sumMoney([input.advance, input.cashCollections, input.spotCash]),
    sumMoney([input.expenses, input.deposited]),
  );
  return {
    openingCash: normalizeMoney(input.advance),
    cashCollections: normalizeMoney(input.cashCollections),
    spotCash: normalizeMoney(input.spotCash),
    expenses: normalizeMoney(input.expenses),
    deposited: normalizeMoney(input.deposited),
    expected,
    declared: input.declared === null ? null : normalizeMoney(input.declared),
    directPayments: normalizeMoney(input.directPayments),
  };
}

const rupees = (amount: string) => `₹${normalizeMoney(amount)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Each area the owner checks before closing: pass, or an exception with
 * what's wrong. Nothing is closed silently: any exception means closing is
 * an approval with a reason (LogisticsService.reconcileTrip).
 *
 * [cashReceived] is what the owner counted; until they've counted, the
 * driver's declared handover stands in for it.
 */
export function checklistOf(facts: TripReviewFacts, handover: HandoverSummary, cashReceived: string | null): ChecklistItem[] {
  const pickups = facts.stops.filter((s) => s.type === 'pickup');
  const deliveries = facts.stops.filter((s) => s.type === 'delivery');
  const items: ChecklistItem[] = [];

  // Procurement: every pickup made.
  const missedPickups = pickups.filter((s) => s.status !== 'completed');
  items.push(
    missedPickups.length === 0
      ? { area: 'procurement', status: 'pass', detail: pickups.length === 0 ? 'No pickups on this trip.' : `${plural(pickups.length, 'pickup', 'pickups')} made.` }
      : {
          area: 'procurement',
          status: 'exception',
          detail: `Not picked up: ${missedPickups.map((s) => `${s.name}${s.notes ? ` (${s.notes})` : ''}`).join('; ')}.`,
        },
  );

  // Deliveries: every delivery made carries proof.
  const done = deliveries.filter((s) => s.status === 'completed');
  const noProof = done.filter((s) => !s.hasPod);
  items.push(
    noProof.length === 0
      ? { area: 'deliveries', status: 'pass', detail: deliveries.length === 0 ? 'No deliveries on this trip.' : `${done.length} of ${deliveries.length} delivered, each with proof of delivery.` }
      : { area: 'deliveries', status: 'exception', detail: `No proof of delivery: ${noProof.map((s) => s.name).join(', ')}.` },
  );

  // Load: what the vehicle carried, product by product — and any shrinkage
  // or breakage beyond what the owner accepts.
  const carried =
    facts.load.length === 0
      ? 'Nothing was carried.'
      : facts.load.map((l) => `${l.product}: picked up ${trimQty(l.pickedUp)} ${l.uom}, delivered ${trimQty(l.delivered)} ${l.uom}`).join('; ') + '.';
  const losses = facts.lossExceptions ?? [];
  items.push(
    losses.length === 0
      ? { area: 'load', status: 'pass', detail: carried }
      : {
          area: 'load',
          status: 'exception',
          detail:
            losses
              .map((x) => `${x.kind === 'weighment' ? 'Shrinkage' : 'Breakage'} ${x.lossPct}% on ${x.product} at ${x.customer} (accepted: ${x.tolerancePct}%)`)
              .join('; ') + `. ${carried}`,
        },
  );

  // Returns & shortages: goods that came back, and why.
  const skipped = deliveries.filter((s) => s.status === 'skipped');
  const returned = facts.load.filter((l) => Number(l.returned) > 0);
  items.push(
    skipped.length === 0
      ? { area: 'returns', status: 'pass', detail: 'Nothing came back.' }
      : {
          area: 'returns',
          status: 'exception',
          detail:
            `Not delivered: ${skipped.map((s) => `${s.name}${s.notes ? ` (${s.notes})` : ''}`).join('; ')}.` +
            (returned.length ? ` Back on the vehicle: ${returned.map((l) => `${trimQty(l.returned)} ${l.uom} ${l.product}`).join(', ')}.` : ''),
        },
  );

  // Collections: cash customers paid on the road.
  items.push(
    facts.unpaidCashCustomers.length === 0
      ? { area: 'collections', status: 'pass', detail: 'Every cash customer paid in full.' }
      : {
          area: 'collections',
          status: 'exception',
          detail: `Cash customers who didn't pay in full: ${facts.unpaidCashCustomers
            .map((u) => `${u.customer} (paid ${rupees(u.collected)} of ${rupees(u.invoiced)})`)
            .join('; ')}.`,
        },
  );

  // Money handover: counted (or declared) against expected.
  const handed = cashReceived ?? handover.declared;
  if (handed === null) {
    items.push({ area: 'handover', status: 'exception', detail: `Expected ${rupees(handover.expected)}; the driver hasn't said what they're handing over.` });
  } else {
    const diff = subtractMoney(handed, handover.expected);
    const who = cashReceived !== null ? 'Received' : 'Driver declared';
    items.push(
      compareMoney(diff, '0') === 0
        ? { area: 'handover', status: 'pass', detail: `${who} ${rupees(handed)}, exactly as expected.` }
        : {
            area: 'handover',
            status: 'exception',
            detail: `${who} ${rupees(handed)} against ${rupees(handover.expected)} expected: ${compareMoney(diff, '0') < 0 ? 'short' : 'over'} by ${rupees(diff.replace('-', ''))}.`,
          },
    );
  }

  // Expenses: shown for the owner to look over; any the driver had no
  // authority to spend (below delegation level 4) need approving.
  const unapproved = facts.expensesNeedingApproval ?? '0';
  items.push(
    compareMoney(unapproved, '0') > 0
      ? {
          area: 'expenses',
          status: 'exception',
          detail: `${rupees(handover.expenses)} spent on the road, of which ${rupees(unapproved)} beyond the driver's authority — approve it with the closure.`,
        }
      : { area: 'expenses', status: 'pass', detail: `${rupees(handover.expenses)} spent on the road.` },
  );

  return items;
}

function trimQty(q: string): string {
  return q.replace(/\.?0+$/, '') || '0';
}
