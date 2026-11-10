import { compareMoney, normalizeMoney, sumMoney } from '../../common/money';

/**
 * The owner's Check before Publish (Master Spec v3 §7.4: capacity, driver,
 * quantities, procurement, deliveries, collections, route). A failed check
 * stops the trip being published — and stops a change to a published trip;
 * a warning is the owner's to weigh. Pure: the facts come from the database.
 */
export type TripCheckKind = 'driver' | 'vehicle' | 'date' | 'stops' | 'quantities' | 'capacity' | 'credit' | 'collections';

export interface TripCheck {
  check: TripCheckKind;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface TripCheckFacts {
  today: string;
  plannedDate: string | null;
  driver: { name: string; active: boolean; hasLogin: boolean };
  /** roadworthy: true, or why the vehicle may not go out (an expired document). */
  vehicle: { registration: string; capacityKg: string; roadworthy: true | string };
  stops: {
    type: 'pickup' | 'delivery';
    name: string;
    /** A delivery: its order's status; a pickup: its pickup's. */
    status: string;
    creditHold: boolean;
    /** A delivery: what the customer owes now (for the collections check). */
    outstanding: string;
    lines: { product: string; uom: string; quantity: string }[];
  }[];
}

const KG_PER: Record<string, number> = { kg: 1, g: 0.001 };
const kgOf = (lines: { uom: string; quantity: string }[]) => lines.reduce((s, l) => s + (KG_PER[l.uom] ?? 0) * Number(l.quantity), 0);
const kgText = (kg: number) => `${Number(kg.toFixed(1)).toLocaleString('en-IN')} kg`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function tripChecksOf(f: TripCheckFacts): TripCheck[] {
  const checks: TripCheck[] = [];
  const pickups = f.stops.filter((s) => s.type === 'pickup');
  const deliveries = f.stops.filter((s) => s.type === 'delivery');

  checks.push(
    !f.driver.active
      ? { check: 'driver', status: 'fail', detail: `${f.driver.name} is not an active worker.` }
      : !f.driver.hasLogin
        ? { check: 'driver', status: 'warn', detail: `${f.driver.name} has no app login: give one under Workforce, or they won't see the trip.` }
        : { check: 'driver', status: 'pass', detail: `${f.driver.name} drives.` },
  );

  checks.push(
    f.vehicle.roadworthy === true
      ? { check: 'vehicle', status: 'pass', detail: `${f.vehicle.registration} is fit for the road.` }
      : { check: 'vehicle', status: 'fail', detail: f.vehicle.roadworthy },
  );

  checks.push(
    f.plannedDate && f.plannedDate < f.today
      ? { check: 'date', status: 'fail', detail: `Planned for ${f.plannedDate}, which has passed: plan it for today or later.` }
      : { check: 'date', status: 'pass', detail: !f.plannedDate ? 'No date: it runs whenever the driver starts it.' : f.plannedDate === f.today ? 'For today.' : `For ${f.plannedDate}.` },
  );

  checks.push(
    f.stops.length === 0
      ? { check: 'stops', status: 'warn', detail: 'No stops: nothing to pick up or deliver.' }
      : { check: 'stops', status: 'pass', detail: `${plural(pickups.length, 'pickup', 'pickups')}, ${plural(deliveries.length, 'delivery', 'deliveries')}.` },
  );

  // Deliveries of confirmed orders, pickups still to be made, every line a real quantity.
  const problems = [
    ...deliveries.filter((s) => s.status !== 'confirmed').map((s) => `${s.name}'s order is ${s.status}, not confirmed`),
    ...pickups.filter((s) => s.status !== 'scheduled').map((s) => `the pickup at ${s.name} is ${s.status}`),
    ...f.stops.filter((s) => s.lines.length === 0 || s.lines.some((l) => !(Number(l.quantity) > 0))).map((s) => `${s.name} has no quantity`),
  ];
  checks.push(
    problems.length > 0
      ? { check: 'quantities', status: 'fail', detail: `${problems.join('; ')}.` }
      : { check: 'quantities', status: 'pass', detail: f.stops.length === 0 ? 'Nothing to check.' : 'Every stop has its quantities, every order is confirmed.' },
  );

  // The heaviest the vehicle gets is at least the larger of what it picks up
  // and what it delivers (deliveries may also come from stock already aboard).
  const capacity = Number(f.vehicle.capacityKg);
  const peak = Math.max(kgOf(pickups.flatMap((s) => s.lines)), kgOf(deliveries.flatMap((s) => s.lines)));
  const notWeighed = f.stops.flatMap((s) => s.lines).filter((l) => !(l.uom in KG_PER)).length;
  const unweighed = notWeighed > 0 ? ` (${plural(notWeighed, 'line', 'lines')} not in kg not counted)` : '';
  checks.push(
    !(capacity > 0)
      ? { check: 'capacity', status: 'warn', detail: `${f.vehicle.registration} has no capacity on record: about ${kgText(peak)} to carry${unweighed}.` }
      : peak > capacity
        ? { check: 'capacity', status: 'fail', detail: `About ${kgText(peak)} to carry on a ${kgText(capacity)} vehicle${unweighed}.` }
        : { check: 'capacity', status: 'pass', detail: `About ${kgText(peak)} of ${kgText(capacity)}${unweighed}.` },
  );

  const held = [...new Set(deliveries.filter((s) => s.creditHold).map((s) => s.name))];
  checks.push(
    held.length > 0
      ? { check: 'credit', status: 'warn', detail: `On credit hold: ${held.join(', ')}.` }
      : { check: 'credit', status: 'pass', detail: 'No customer on the trip is on credit hold.' },
  );

  const owing = deliveries.filter((s) => compareMoney(s.outstanding, '0') > 0);
  const total = sumMoney(owing.map((s) => s.outstanding));
  checks.push({
    check: 'collections',
    status: 'pass',
    detail: owing.length === 0 ? 'Nothing owed by the customers on the trip.' : `₹${normalizeMoney(total)} owed by ${plural(new Set(owing.map((s) => s.name)).size, 'customer', 'customers')} on the trip.`,
  });

  return checks;
}

/** The checks that stop publishing (and stop a change to a published trip). */
export const failedChecks = (checks: TripCheck[]) => checks.filter((c) => c.status === 'fail');
