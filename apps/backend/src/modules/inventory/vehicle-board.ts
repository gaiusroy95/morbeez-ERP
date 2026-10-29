import { fromMilli, minMilli, toMilli } from '../../common/quantity';
import { VehicleBoard, VehicleBoardCard, VehicleBoardProduct } from './entities/vehicle-board.entity';
import { VehicleProductRow, VehicleRow } from './repositories/vehicle-board.repository';

const maxMilli = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/**
 * Vehicle Stock (redesign V1.1, screen 13). On each vehicle, product by
 * product, what's committed to its deliveries — the kilos reserved aboard,
 * or what its trip on the road still has to deliver if that's more (the
 * farm pickups cover the rest), never more than is aboard — and what's free
 * to sell on the spot or bring back. Totals in kg.
 */
export function vehicleBoardOf(vehicles: VehicleRow[], rows: VehicleProductRow[]): VehicleBoard {
  let onVehicles = 0n;
  let committedKg = 0n;
  let freeKg = 0n;
  const cards: VehicleBoardCard[] = vehicles.map((v) => {
    let total = 0n;
    const products: VehicleBoardProduct[] = rows
      .filter((r) => r.vehicle_id === v.vehicle_id)
      .map((r) => {
        const on = toMilli(r.on_vehicle);
        const committed = minMilli(on, maxMilli(toMilli(r.reserved), toMilli(r.to_deliver)));
        if (r.uom === 'kg') {
          total += on;
          onVehicles += on;
          committedKg += committed;
          freeKg += on - committed;
        }
        return {
          productId: r.product_id,
          product: r.product,
          uom: r.uom,
          onVehicle: fromMilli(on),
          committed: fromMilli(committed),
          free: fromMilli(on - committed),
          toDeliver: r.to_deliver,
        };
      });
    return {
      vehicleId: v.vehicle_id,
      registrationNumber: v.registration_number,
      status: v.trip_id ? 'in_transit' : 'available',
      tripId: v.trip_id,
      tripNumber: v.trip_number,
      driverName: v.driver_name,
      totalKg: fromMilli(total),
      products,
    };
  });
  return {
    vehicles: cards,
    totalsKg: { onVehicles: fromMilli(onVehicles), committed: fromMilli(committedKg), free: fromMilli(freeKg) },
  };
}
