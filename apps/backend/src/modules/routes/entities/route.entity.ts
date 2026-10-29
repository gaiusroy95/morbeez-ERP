export type RouteStatus = 'active' | 'archived';

/** A delivery route the business runs ("Mysuru North"). */
export interface RouteRecord {
  id: string;
  name: string;
  status: RouteStatus;
  createdAt: Date;
  /** How many customers and farmers are stops on it. */
  customers: number;
  farmers: number;
}

export type RoutePartyKind = 'customer' | 'farmer';

/** A customer or farmer on a route, in the order the vehicle visits them. */
export interface RouteStopRecord {
  position: number;
  kind: RoutePartyKind;
  partyId: string;
  name: string;
  place: string | null;
  phone: string | null;
  /** The party's map pin, when one is set (Logistics → pins). */
  latitude: string | null;
  longitude: string | null;
  status: 'active' | 'archived';
}
