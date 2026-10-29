/** One product on a vehicle (redesign V1.1, Inventory → Vehicle Stock). */
export interface VehicleBoardProduct {
  productId: string;
  product: string;
  uom: string;
  onVehicle: string;
  /** Held for the vehicle's deliveries: what's reserved aboard, or what its trip still has to deliver, whichever is more — never more than is aboard. */
  committed: string;
  free: string;
  /** What the vehicle's trip on the road still has to deliver. */
  toDeliver: string;
}

export interface VehicleBoardCard {
  vehicleId: string;
  registrationNumber: string;
  /** On a trip that has set off (in transit), or not (available). */
  status: 'in_transit' | 'available';
  tripId: string | null;
  tripNumber: string | null;
  /** The trip's driver — or, between trips, whoever drove it last. */
  driverName: string | null;
  totalKg: string;
  products: VehicleBoardProduct[];
}

export interface VehicleBoard {
  vehicles: VehicleBoardCard[];
  totalsKg: { onVehicles: string; committed: string; free: string };
}
