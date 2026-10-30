// Collections on a trip (driver app V1, D4; client spec §18–§21): only the
// customers delivered on it, each with what they owe in all — not just this
// trip's invoice. Mirrored in packages/shared-types/src/logistics.

export interface TripCollectionCustomer {
  customerId: string;
  name: string;
  phone: string | null;
  place: string | null;
  /** The delivery stop a collection from them is recorded at (their last on the trip). */
  stopId: string;
  terms: 'cash' | 'credit';
  /** Their whole outstanding now, after anything collected. */
  outstanding: string;
  /** Of that, disputed and with the owner. */
  disputed: string;
  collectedOnTrip: string;
}

export interface TripCollections {
  tripId: string;
  customers: TripCollectionCustomer[];
  /** Collected on this trip, by how it was paid. */
  collected: { cash: string; upi: string; bankTransfer: string; cheque: string; total: string };
  /** Customers still owing (outstanding less disputed), and how much. */
  pending: { customers: number; amount: string };
}
