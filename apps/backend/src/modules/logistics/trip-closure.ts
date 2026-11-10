import { compareMoney, normalizeMoney, subtractMoney, sumMoney } from '../../common/money';
import { ChecklistItem } from './entities/trip-reconciliation.entity';
import { TripReviewFacts } from './repositories/trip-reconciliations.repository';
import { ClosingStockLine } from './entities/trip-planning.entity';
import { backhaulCheckOf } from './backhaul';

/**
 * What the driver should hand over (pilot baseline, money handover):
 *
 *   expected = opening cash (the advance) + cash collected at deliveries
 *              + other cash receipts (spot sales, backhaul rent)
 *              − cash expenses − cash deposited in the bank on the road
 *
 * UPI/bank/cheque payments went straight to the business: they're shown,
 * never handed over.
 */
export interface HandoverSummary {
  openingCash: string;
  cashCollections: string;
  spotCash: string;
  /** Backhaul rent paid to the driver in cash (driver app D5). */
  backhaulCash: string;
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
  backhaulCash?: string;
  expenses: string;
  deposited: string;
  declared: string | null;
  directPayments: string;
}): HandoverSummary {
  const backhaulCash = input.backhaulCash ?? '0';
  const expected = subtractMoney(
    sumMoney([input.advance, input.cashCollections, input.spotCash, backhaulCash]),
    sumMoney([input.expenses, input.deposited]),
  );
  return {
    openingCash: normalizeMoney(input.advance),
    cashCollections: normalizeMoney(input.cashCollections),
    spotCash: normalizeMoney(input.spotCash),
    backhaulCash: normalizeMoney(backhaulCash),
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
export function checklistOf(
  facts: TripReviewFacts,
  handover: HandoverSummary,
  cashReceived: string | null,
  closingStock: ClosingStockLine[] | null = null,
): ChecklistItem[] {
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

  // Load: what the vehicle carried, product by product — any shrinkage or
  // breakage beyond what the owner accepts, and, when the vehicle was
  // counted at closing, any product not as it should be.
  const carried =
    facts.load.length === 0
      ? 'Nothing was carried.'
      : facts.load.map((l) => `${l.product}: picked up ${trimQty(l.pickedUp)} ${l.uom}, delivered ${trimQty(l.delivered)} ${l.uom}`).join('; ') + '.';
  const losses = facts.lossExceptions ?? [];
  const offCount = (closingStock ?? []).filter((c) => Math.abs(Number(c.counted) - Number(c.expected)) >= 0.0005);
  const problems = [
    ...losses.map((x) => `${x.kind === 'weighment' ? 'Shrinkage' : 'Breakage'} ${x.lossPct}% on ${x.product} at ${x.customer} (accepted: ${x.tolerancePct}%)`),
    ...offCount.map((c) => {
      const diff = Number(c.counted) - Number(c.expected);
      return `${c.product} on the vehicle: counted ${trimQty(c.counted)} ${c.uom}, expected ${trimQty(c.expected)} ${c.uom} (${trimQty(Math.abs(diff).toFixed(3))} ${c.uom} ${diff < 0 ? 'short' : 'over'})`;
    }),
  ];
  const counted = closingStock === null ? '' : offCount.length === 0 ? ' Vehicle closing stock counted: as expected.' : '';
  items.push(
    problems.length === 0
      ? { area: 'load', status: 'pass', detail: carried + counted }
      : { area: 'load', status: 'exception', detail: `${problems.join('; ')}. ${carried}` },
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

  // Backhaul (driver app D5): done or validly skipped, and paid — only on a trip that had one.
  const backhaul = backhaulCheckOf(facts.backhauls ?? []);
  if (backhaul) items.push(backhaul);

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
  const rejected = facts.expensesRejected ?? '0';
  items.push(
    compareMoney(unapproved, '0') > 0
      ? {
          area: 'expenses',
          status: 'exception',
          detail: `${rupees(handover.expenses)} spent on the road, of which ${rupees(unapproved)} beyond the driver's authority — approve it with the closure.`,
        }
      : compareMoney(rejected, '0') > 0
        ? {
            area: 'expenses',
            status: 'exception',
            detail: `${rupees(handover.expenses)} spent on the road, of which you rejected ${rupees(rejected)} — settle it with the driver.`,
          }
        : { area: 'expenses', status: 'pass', detail: `${rupees(handover.expenses)} spent on the road.` },
  );

  // ---- Master Spec v3 §60 (P1) ----
  // Workforce: the driver's work recorded (when they submitted). A missing
  // pay rate shows here and in Pay run; it doesn't make the trip wrong.
  if (facts.workforce) {
    const wf = facts.workforce;
    const crew = wf.crewCredits > 0 ? ` ${plural(wf.crewCredits, 'crew credit', 'crew credits')} for loading.` : '';
    const rate = wf.hasPayRate ? '' : ` ${wf.driver} has no pay rate on file — set one under Workforce before the week's pay.`;
    items.push(
      wf.workRecorded
        ? { area: 'workforce', status: 'pass', detail: `${wf.driver}'s work on this trip is recorded.${crew}${rate}` }
        : { area: 'workforce', status: 'exception', detail: `${wf.driver}'s work on this trip isn't recorded.${rate}` },
    );
  }

  // Workload: when each completed stop was reached and finished — the
  // service effort customers' economics are worked out from (§17, §20).
  if (facts.untimedStops) {
    const done = facts.stops.filter((s) => s.status === 'completed').length;
    items.push(
      facts.untimedStops.length === 0
        ? { area: 'workload', status: 'pass', detail: done === 0 ? 'No stops completed.' : `Arrival and completion times recorded at all ${plural(done, 'stop', 'stops')}.` }
        : { area: 'workload', status: 'exception', detail: `No arrival or completion time at: ${facts.untimedStops.join(', ')}.` },
    );
  }

  // Vehicle: the odometer read at the start and at the return, and a trip KM
  // that could be true.
  if (facts.vehicle) {
    const v = facts.vehicle;
    const kmRun = v.openingKm !== null && v.closingKm !== null ? Number(v.closingKm) - Number(v.openingKm) : null;
    const fuel = Number(v.litres) > 0 ? ` ${trimQty(v.litres)} L of fuel put in${kmRun && kmRun > 0 ? ` (${(kmRun / Number(v.litres)).toFixed(1)} km/L)` : ''}.` : '';
    items.push(
      v.openingKm === null || v.closingKm === null
        ? { area: 'vehicle', status: 'exception', detail: `No ${v.openingKm === null ? 'opening' : 'closing'} KM recorded${v.openingKm === null && v.closingKm === null ? ' (nor closing)' : ''}.` }
        : kmRun !== null && kmRun > MAX_TRIP_KM
          ? { area: 'vehicle', status: 'exception', detail: `${trimQty(String(kmRun))} km in a day (${trimQty(v.openingKm)} → ${trimQty(v.closingKm)}) — check the readings.${fuel}` }
          : { area: 'vehicle', status: 'pass', detail: `${trimQty(String(kmRun))} km (${trimQty(v.openingKm)} → ${trimQty(v.closingKm)}).${fuel}` },
    );
  }

  // Exceptions: nothing raised on the trip still waiting for the owner.
  if (facts.openItems) {
    items.push(
      facts.openItems.length === 0
        ? { area: 'exceptions', status: 'pass', detail: 'No dispute or request from this trip is open.' }
        : { area: 'exceptions', status: 'exception', detail: `Still open: ${facts.openItems.join('; ')}.` },
    );
  }

  // Accounting: every money event on the trip is in the books, each journal balanced.
  if (facts.books) {
    const b = facts.books;
    const problems = [
      ...(b.missing.length ? [`not in the books: ${b.missing.join('; ')}`] : []),
      ...(b.unbalanced > 0 ? [`${plural(b.unbalanced, 'journal doesn’t', 'journals don’t')} balance`] : []),
    ];
    items.push(
      problems.length === 0
        ? { area: 'accounting', status: 'pass', detail: 'Every collection, expense, deposit, backhaul payment and the advance is in the books, each journal balanced.' }
        : { area: 'accounting', status: 'exception', detail: `${problems.join('; ')}.` },
    );
  }

  return items;
}

/** More than this in one trip is a misread odometer, not a day's driving. */
const MAX_TRIP_KM = 1500;

/** "100.500" → "100.5", "48620.0" → "48620" — and "48620" stays 48620: only zeros after a decimal point go. */
function trimQty(q: string): string {
  return q.includes('.') ? q.replace(/\.?0+$/, '') || '0' : q;
}
