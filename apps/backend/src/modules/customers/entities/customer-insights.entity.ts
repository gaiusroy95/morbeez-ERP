import { CustomerRecord } from './customer.entity';

export type CustomersFilter = 'all' | 'active' | 'credit' | 'overdue';

/**
 * A card on the owner's Customers list (redesign V1.1, screen 10). The
 * money figures are null for someone without finance:read.
 */
export interface CustomerCard {
  id: string;
  name: string;
  place: string | null;
  phone: string | null;
  routeId: string | null;
  routeName: string | null;
  status: 'active' | 'archived';
  creditHold: boolean;
  /** Everything invoiced to them (sales). */
  totalSales: string | null;
  outstanding: string | null;
  overdue: string | null;
  oldestOverdueDays: number | null;
  /** 0–5; null with no payment history (or without finance:read). */
  score: number | null;
  creditRisk: boolean | null;
}

export interface CustomersBoard {
  filter: CustomersFilter;
  /** null where the caller can't see money (credit and overdue need finance:read). */
  counts: { all: number; active: number; credit: number | null; overdue: number | null };
  total: number;
  page: number;
  pageSize: number;
  items: CustomerCard[];
}

/** Customer Profile (redesign V1.1, screen 11): the record, where they are, and how they buy and pay. */
export interface CustomerProfile {
  customer: CustomerRecord;
  routeName: string | null;
  pin: { latitude: string; longitude: string } | null;
  /** Their orders — null without orders:read. */
  orders: {
    count: number;
    avgOrderValue: string | null;
    lastOrderAt: Date | null;
    recent: { id: string; number: number; day: string; status: string; total: string }[];
  } | null;
  /** Sales, what they owe and how they pay — null without finance:read. */
  money: {
    totalSales: string;
    salesLast30Days: string;
    salesPrevious30Days: string;
    outstanding: string;
    overdue: string;
    oldestOverdueDays: number | null;
    onAccount: string;
    openOrderValue: string;
    creditLimit: string;
    available: string;
    settledInvoices: number;
    avgPaymentDays: number | null;
    onTimePct: number | null;
    score: number | null;
    creditRisk: boolean;
    /** Goods sold (before GST) less their cost — all time. */
    revenue: string;
    costOfGoods: string;
    grossMargin: string;
    grossMarginPct: number | null;
    topProducts: { name: string; uom: string; quantity: string; revenue: string }[];
  } | null;
}
