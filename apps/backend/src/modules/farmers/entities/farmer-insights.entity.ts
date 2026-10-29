import { FarmerRecord } from './farmer.entity';

export type FarmersFilter = 'all' | 'active' | 'pending';

/** A card on the owner's Farmers list (redesign V1.1, screen 12). Money is null without finance:read. */
export interface FarmerCard {
  id: string;
  name: string;
  place: string | null;
  phone: string | null;
  routeName: string | null;
  status: 'active' | 'archived';
  /** What they sell most (by kg graded, else ordered). */
  mainProduct: string | null;
  /** Everything bought from them (graded lots at their cost). */
  totalPurchases: string | null;
  /** Still owed to them. */
  owed: string | null;
  /** Paid ahead, not yet set against a lot. */
  advance: string | null;
  lastPickupAt: Date | null;
}

export interface FarmersBoard {
  filter: FarmersFilter;
  place: string | null;
  counts: { all: number; active: number; pending: number | null };
  /** Their villages and towns, for "By Location". */
  places: { place: string; farmers: number }[];
  total: number;
  page: number;
  pageSize: number;
  items: FarmerCard[];
}

/** Farmer profile: the record, where they are, what they sell, and what they're owed. */
export interface FarmerProfile {
  farmer: FarmerRecord;
  routeName: string | null;
  pin: { latitude: string; longitude: string } | null;
  /** With procurement:read. */
  purchases: {
    count: number;
    open: number;
    lastPickupAt: Date | null;
    recent: { id: string; number: number; day: string; status: string; kg: string; value: string }[];
    products: { name: string; uom: string; quantity: string; value: string; avgRate: string | null }[];
  } | null;
  /** With finance:read. */
  money: {
    totalPurchases: string;
    owed: string;
    paid: string;
    advance: string;
    oldestUnpaidAt: Date | null;
    lastPaidAt: Date | null;
    payments: { id: string; paidAt: Date; amount: string; method: string; reference: string | null }[];
  } | null;
}
