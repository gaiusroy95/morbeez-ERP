// Logistics optimization, classical (System Architecture AI.3: operations
// research, not machine learning). Distances are straight-line km between
// map pins times a road factor; a route is depot → stops → depot, improved
// by nearest-neighbour then 2-opt. Loads are packed by the sweep method:
// orders sorted by bearing from the depot fill the cheapest fitting vehicle.

export interface Point {
  lat: number;
  lng: number;
}

export const ROAD_FACTOR = 1.3;

export function km(a: Point, b: Point): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * ROAD_FACTOR;
}

/** Length of depot → points (in order) → depot. */
export function tourKm(depot: Point, points: Point[]): number {
  if (!points.length) return 0;
  let total = km(depot, points[0]);
  for (let i = 1; i < points.length; i++) total += km(points[i - 1], points[i]);
  return total + km(points[points.length - 1], depot);
}

/** A good order for `points` from the depot and back: indices into `points`. */
export function bestOrder(depot: Point, points: Point[]): number[] {
  const n = points.length;
  if (n <= 1) return points.map((_, i) => i);
  // Nearest neighbour from the depot.
  const left = new Set(points.map((_, i) => i));
  const order: number[] = [];
  let at = depot;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = km(at, points[i]);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && i < best)) {
        best = i;
        bestD = d;
      }
    }
    order.push(best);
    left.delete(best);
    at = points[best];
  }
  // 2-opt: reverse any segment that shortens the tour, until none does.
  const len = (o: number[]) => tourKm(depot, o.map((i) => points[i]));
  let improved = true;
  let current = len(order);
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const d = len(candidate);
        if (d < current - 1e-6) {
          order.splice(0, n, ...candidate);
          current = d;
          improved = true;
        }
      }
    }
  }
  return order;
}

export interface LoadOrder {
  orderId: string;
  kg: number;
  point: Point | null;
}

export interface LoadVehicle {
  vehicleId: string;
  capacityKg: number;
  costPerKm: number;
}

export interface PlannedLoad {
  vehicleId: string;
  orderIds: string[]; // in delivery order
  kg: number;
  km: number | null; // null when some stop has no pin
  unpinned: string[];
}

function bearing(depot: Point, p: Point): number {
  return Math.atan2(p.lat - depot.lat, p.lng - depot.lng);
}

/**
 * Sweep: orders by bearing from the depot (unpinned ones last), each
 * vehicle — cheapest per km first — takes the next orders while they fit.
 * Orders heavier than every vehicle are left out and reported.
 */
export function planLoads(depot: Point | null, orders: LoadOrder[], vehicles: LoadVehicle[]): { loads: PlannedLoad[]; unplaced: string[] } {
  const pinned = orders.filter((o) => o.point && depot).sort((a, b) => bearing(depot!, a.point!) - bearing(depot!, b.point!));
  const rest = orders.filter((o) => !(o.point && depot)).sort((a, b) => b.kg - a.kg);
  const queue = [...pinned, ...rest];
  const fleet = [...vehicles].sort((a, b) => a.costPerKm - b.costPerKm || b.capacityKg - a.capacityKg);
  const loads: PlannedLoad[] = [];
  const unplaced: string[] = [];
  for (const v of fleet) {
    if (!queue.length) break;
    const taken: LoadOrder[] = [];
    let kg = 0;
    for (let i = 0; i < queue.length; ) {
      if (kg + queue[i].kg <= v.capacityKg) {
        kg += queue[i].kg;
        taken.push(...queue.splice(i, 1));
      } else i++;
    }
    if (!taken.length) continue;
    const withPin = taken.filter((o) => o.point);
    const order = depot && withPin.length ? bestOrder(depot, withPin.map((o) => o.point!)).map((i) => withPin[i]) : withPin;
    const unpinned = taken.filter((o) => !o.point);
    loads.push({
      vehicleId: v.vehicleId,
      orderIds: [...order, ...unpinned].map((o) => o.orderId),
      kg: Math.round(kg * 1000) / 1000,
      km: depot && !unpinned.length ? Math.round(tourKm(depot, order.map((o) => o.point!)) * 10) / 10 : null,
      unpinned: unpinned.map((o) => o.orderId),
    });
  }
  unplaced.push(...queue.map((o) => o.orderId));
  return { loads, unplaced };
}
